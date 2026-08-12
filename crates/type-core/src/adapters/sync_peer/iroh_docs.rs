//! Persistent encrypted filesystem synchronization over `iroh-docs`.
//!
//! `iroh-docs` is the queue, replica store, and reconciliation engine. Type
//! only bridges its values to ordinary files and encrypts every value before
//! Iroh sees it. No application-owned SQLite journal is involved.

use super::{
    decrypt_sync_peer_operation, encrypt_sync_peer_operation_for_object_id,
    opaque_sync_peer_file_id, EncryptedSyncPeerEnvelope, SyncPeerOperation,
    SyncPeerOperationPayload, SyncPeerVaultKey,
};
use crate::{
    app_data_dir, ensure_profiles_state, find_profile, now_ms, sanitize_relative, AppEnv,
    ATTACHMENTS_STORAGE_FOLDER, RECORDINGS_STORAGE_FOLDER,
};
use iroh::{endpoint::presets, protocol::Router, Endpoint, EndpointAddr, SecretKey};
use iroh_blobs::{api::blobs::Blobs, store::fs::FsStore, BlobsProtocol, ALPN as BLOBS_ALPN};
use iroh_docs::{
    api::{
        protocol::{AddrInfoOptions, ShareMode},
        Doc,
    },
    engine::LiveEvent,
    protocol::Docs,
    store::Query,
    sync::Capability,
    AuthorId, DocTicket, ALPN as DOCS_ALPN,
};
use iroh_gossip::{net::Gossip, ALPN as GOSSIP_ALPN};
use iroh_tickets::endpoint::EndpointTicket;
use n0_future::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
    str::FromStr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use uuid::Uuid;

const CONFIG_VERSION: u8 = 1;
const SYNC_FOLDER: &str = "iroh_docs_sync";
const CONFIG_FILE: &str = "config.json";
const IDENTITY_FILE: &str = "identity.key";
const MAX_ENVELOPE_BYTES: u64 = 18 * 1024 * 1024;
const AUTO_SYNC_DEBOUNCE_MS: u64 = 900;
const MANUAL_SYNC_WAIT_MS: u64 = 2_500;

#[derive(Clone, Debug, Deserialize, Serialize)]
struct IrohDocsSyncConfig {
    version: u8,
    profile_id: String,
    device_id: String,
    vault_key: String,
    write_doc_ticket: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    peer_endpoint_ticket: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ConfigureIrohDocsSyncArgs {
    pub write_doc_ticket: String,
    pub vault_key: String,
    pub peer_endpoint_ticket: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SetIrohDocsSyncPeerArgs {
    pub peer_endpoint_ticket: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct IrohDocsPairingBundle {
    pub write_doc_ticket: String,
    pub vault_key: String,
    pub peer_endpoint_ticket: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct IrohDocsBootstrapResult {
    pub status: IrohDocsSyncStatus,
    pub pairing: IrohDocsPairingBundle,
    /// Give this read-only ticket to `type-sync-peer`. It cannot write entries
    /// and is useless for decrypting their values.
    pub peer_read_doc_ticket: String,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct IrohDocsSyncResult {
    pub published: usize,
    pub unchanged: usize,
    pub tombstones: usize,
    pub applied: usize,
    pub conflicts: usize,
    pub entries_received: usize,
    pub entries_sent: usize,
    pub connected: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct IrohDocsSyncStatus {
    pub configured: bool,
    pub running: bool,
    pub profile_id: String,
    pub document_id: Option<String>,
    pub endpoint_id: Option<String>,
    pub peer_configured: bool,
    pub phase: String,
    pub last_sync_ms: Option<i64>,
    pub last_error: Option<String>,
    pub neighbors: usize,
}

#[derive(Default)]
struct LiveStatus {
    phase: String,
    last_sync_ms: Option<i64>,
    last_error: Option<String>,
    neighbors: usize,
}

#[derive(Clone)]
struct ActiveProfile {
    id: String,
    root: PathBuf,
    node_dir: PathBuf,
}

struct SpawnedProtocols {
    router: Router,
    docs: Docs,
    blobs: Blobs,
    endpoint_addr: EndpointAddr,
}

struct SyncContext {
    profile: ActiveProfile,
    config: IrohDocsSyncConfig,
    doc: Doc,
    blobs: Blobs,
    author: AuthorId,
    peers: Vec<EndpointAddr>,
    vault_key: SyncPeerVaultKey,
    live: Arc<Mutex<LiveStatus>>,
    debounce_generation: AtomicU64,
}

struct IrohDocsNode {
    runtime: tokio::runtime::Runtime,
    router: Router,
    context: Arc<SyncContext>,
    endpoint_ticket: String,
}

impl IrohDocsNode {
    fn stop(self) {
        let Self {
            runtime, router, ..
        } = self;
        let _ = runtime.block_on(router.shutdown());
        runtime.shutdown_background();
    }

    fn status(&self) -> IrohDocsSyncStatus {
        let live = self.context.live.lock().ok();
        IrohDocsSyncStatus {
            configured: true,
            running: true,
            profile_id: self.context.profile.id.clone(),
            document_id: Some(self.context.doc.id().to_string()),
            endpoint_id: Some(self.router.endpoint().id().to_string()),
            peer_configured: self.context.config.peer_endpoint_ticket.is_some(),
            phase: live
                .as_ref()
                .map(|status| status.phase.clone())
                .unwrap_or_else(|| "running".to_string()),
            last_sync_ms: live.as_ref().and_then(|status| status.last_sync_ms),
            last_error: live.as_ref().and_then(|status| status.last_error.clone()),
            neighbors: live.as_ref().map(|status| status.neighbors).unwrap_or(0),
        }
    }
}

#[derive(Clone)]
struct StoredOperation {
    author: AuthorId,
    operation: SyncPeerOperation,
}

#[derive(Default)]
struct PublishSummary {
    published: usize,
    unchanged: usize,
    tombstones: usize,
}

#[derive(Default)]
struct ApplySummary {
    applied: usize,
    conflicts: usize,
}

static NODE: Mutex<Option<IrohDocsNode>> = Mutex::new(None);
static SYNC_LISTENER: Mutex<Option<Box<dyn Fn() + Send + Sync>>> = Mutex::new(None);

/// Desktop shells use this to refresh the visible tree after background sync.
pub fn set_iroh_docs_sync_listener(listener: Box<dyn Fn() + Send + Sync>) {
    if let Ok(mut current) = SYNC_LISTENER.lock() {
        *current = Some(listener);
    }
}

fn notify_sync_listener() {
    if let Ok(listener) = SYNC_LISTENER.lock() {
        if let Some(listener) = listener.as_ref() {
            listener();
        }
    }
}

/// Create or reopen a vault on this trusted device and return both pairing
/// material and the strictly read-only ticket intended for the storage peer.
pub fn bootstrap_iroh_docs_sync(app: &AppEnv) -> Result<IrohDocsBootstrapResult, String> {
    let profile = active_profile(app)?;
    let mut guard = NODE
        .lock()
        .map_err(|_| "Iroh Docs node lock poisoned.".to_string())?;
    stop_wrong_profile(&mut guard, &profile.id);

    if guard.is_none() {
        if let Some(config) = read_config(&profile)? {
            *guard = Some(spawn_configured_node(profile.clone(), config)?);
        } else {
            let (node, config) = create_vault_node(profile.clone())?;
            write_config(&profile, &config)?;
            *guard = Some(node);
        }
    }

    let node = guard.as_ref().expect("node inserted");
    let (pairing, read_ticket) = node.runtime.block_on(export_pairing_material(node))?;
    let _ = node.runtime.block_on(sync_once(node.context.clone()));
    Ok(IrohDocsBootstrapResult {
        status: node.status(),
        pairing,
        peer_read_doc_ticket: read_ticket,
    })
}

/// Import trusted-device pairing material (normally from the desktop QR).
pub fn configure_iroh_docs_sync(
    app: &AppEnv,
    args: ConfigureIrohDocsSyncArgs,
) -> Result<IrohDocsSyncStatus, String> {
    let profile = active_profile(app)?;
    let vault_key = SyncPeerVaultKey::from_base64(args.vault_key.trim())?;
    let ticket = parse_write_ticket(&args.write_doc_ticket)?;
    let peer_endpoint_ticket = normalize_peer_ticket(args.peer_endpoint_ticket)?;
    let config = IrohDocsSyncConfig {
        version: CONFIG_VERSION,
        profile_id: profile.id.clone(),
        device_id: Uuid::now_v7().to_string(),
        vault_key: vault_key.to_base64(),
        write_doc_ticket: ticket.to_string(),
        peer_endpoint_ticket,
    };
    write_config(&profile, &config)?;

    let mut guard = NODE
        .lock()
        .map_err(|_| "Iroh Docs node lock poisoned.".to_string())?;
    if let Some(node) = guard.take() {
        node.stop();
    }
    *guard = Some(spawn_configured_node(profile, config)?);
    let node = guard.as_ref().expect("node inserted");
    let _ = node.runtime.block_on(sync_once(node.context.clone()));
    Ok(node.status())
}

/// Add or replace the persistent peer address. Passing null/empty removes it.
pub fn set_iroh_docs_sync_peer(
    app: &AppEnv,
    args: SetIrohDocsSyncPeerArgs,
) -> Result<IrohDocsSyncStatus, String> {
    let profile = active_profile(app)?;
    let mut config = read_config(&profile)?
        .ok_or_else(|| "Enable Iroh Docs sync before configuring a peer.".to_string())?;
    config.peer_endpoint_ticket = normalize_peer_ticket(args.peer_endpoint_ticket)?;
    write_config(&profile, &config)?;

    let mut guard = NODE
        .lock()
        .map_err(|_| "Iroh Docs node lock poisoned.".to_string())?;
    if let Some(node) = guard.take() {
        node.stop();
    }
    *guard = Some(spawn_configured_node(profile, config)?);
    Ok(guard.as_ref().expect("node inserted").status())
}

/// Start the persistent node when configured. This is safe at app startup.
pub fn start_iroh_docs_sync_if_configured(app: &AppEnv) -> Result<IrohDocsSyncStatus, String> {
    let profile = active_profile(app)?;
    let Some(config) = read_config(&profile)? else {
        return Ok(disabled_status(profile.id));
    };
    let mut guard = NODE
        .lock()
        .map_err(|_| "Iroh Docs node lock poisoned.".to_string())?;
    stop_wrong_profile(&mut guard, &profile.id);
    if guard.is_none() {
        *guard = Some(spawn_configured_node(profile, config)?);
    }
    Ok(guard.as_ref().expect("node inserted").status())
}

pub fn get_iroh_docs_sync_status(app: &AppEnv) -> Result<IrohDocsSyncStatus, String> {
    let profile = active_profile(app)?;
    let configured = read_config(&profile)?.is_some();
    let guard = NODE
        .lock()
        .map_err(|_| "Iroh Docs node lock poisoned.".to_string())?;
    if let Some(node) = guard
        .as_ref()
        .filter(|node| node.context.profile.id == profile.id)
    {
        return Ok(node.status());
    }
    if configured {
        Ok(IrohDocsSyncStatus {
            configured: true,
            running: false,
            profile_id: profile.id,
            document_id: None,
            endpoint_id: None,
            peer_configured: false,
            phase: "stopped".to_string(),
            last_sync_ms: None,
            last_error: None,
            neighbors: 0,
        })
    } else {
        Ok(disabled_status(profile.id))
    }
}

/// Explicit user action. Publishes the final local filesystem state, asks
/// Iroh to reconcile with known peers, applies available remote state, and
/// reports bounded progress without creating Git commits.
pub fn sync_iroh_docs_now(app: &AppEnv) -> Result<IrohDocsSyncResult, String> {
    start_iroh_docs_sync_if_configured(app)?;
    let profile = active_profile(app)?;
    let guard = NODE
        .lock()
        .map_err(|_| "Iroh Docs node lock poisoned.".to_string())?;
    let node = guard
        .as_ref()
        .filter(|node| node.context.profile.id == profile.id)
        .ok_or_else(|| "Iroh Docs sync is not configured for this profile.".to_string())?;
    set_phase(&node.context, "syncing", None);
    match node.runtime.block_on(sync_once(node.context.clone())) {
        Ok(result) => {
            set_phase(
                &node.context,
                if result.connected {
                    "synced"
                } else {
                    "waiting_for_peer"
                },
                None,
            );
            Ok(result)
        }
        Err(error) => {
            set_phase(&node.context, "error", Some(error.clone()));
            Err(error)
        }
    }
}

/// Debounced autosync called by note mutation commands in both shells.
pub fn schedule_iroh_docs_sync(app: &AppEnv) {
    let Ok(status) = start_iroh_docs_sync_if_configured(app) else {
        return;
    };
    if !status.configured {
        return;
    }
    let Ok(guard) = NODE.lock() else {
        return;
    };
    let Some(node) = guard.as_ref() else {
        return;
    };
    let generation = node
        .context
        .debounce_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let context = node.context.clone();
    set_phase(&context, "saved_locally", None);
    node.runtime.spawn(async move {
        tokio::time::sleep(Duration::from_millis(AUTO_SYNC_DEBOUNCE_MS)).await;
        if context.debounce_generation.load(Ordering::SeqCst) != generation {
            return;
        }
        set_phase(&context, "syncing", None);
        match sync_once(context.clone()).await {
            Ok(result) => set_phase(
                &context,
                if result.connected {
                    "synced"
                } else {
                    "waiting_for_peer"
                },
                None,
            ),
            Err(error) => set_phase(&context, "error", Some(error)),
        }
    });
}

pub fn shutdown_iroh_docs_sync() {
    if let Ok(mut guard) = NODE.lock() {
        if let Some(node) = guard.take() {
            node.stop();
        }
    }
}

fn spawn_configured_node(
    profile: ActiveProfile,
    config: IrohDocsSyncConfig,
) -> Result<IrohDocsNode, String> {
    validate_config(&profile, &config)?;
    let runtime = sync_runtime()?;
    let (protocols, doc, author, peers) = runtime.block_on(async {
        let protocols = spawn_protocols(&profile).await?;
        let ticket = parse_write_ticket(&config.write_doc_ticket)?;
        let mut peers = ticket.nodes.clone();
        if let Some(peer) = &config.peer_endpoint_ticket {
            peers.push(parse_endpoint_ticket(peer)?);
        }
        peers.retain(|peer| peer.id != protocols.endpoint_addr.id);
        deduplicate_peers(&mut peers);
        let doc = protocols
            .docs
            .import_namespace(ticket.capability)
            .await
            .map_err(|error| format!("Failed to import the Iroh document: {error}"))?;
        let author = protocols
            .docs
            .author_default()
            .await
            .map_err(|error| format!("Failed to load the Iroh document author: {error}"))?;
        Ok::<_, String>((protocols, doc, author, peers))
    })?;
    finish_node(runtime, protocols, profile, config, doc, author, peers)
}

fn create_vault_node(profile: ActiveProfile) -> Result<(IrohDocsNode, IrohDocsSyncConfig), String> {
    let runtime = sync_runtime()?;
    let (protocols, doc, author, config) = runtime.block_on(async {
        let protocols = spawn_protocols(&profile).await?;
        let doc = protocols
            .docs
            .create()
            .await
            .map_err(|error| format!("Failed to create the Iroh document: {error}"))?;
        let author = protocols
            .docs
            .author_default()
            .await
            .map_err(|error| format!("Failed to create the Iroh document author: {error}"))?;
        let write_ticket = doc
            .share(ShareMode::Write, AddrInfoOptions::RelayAndAddresses)
            .await
            .map_err(|error| format!("Failed to export the Iroh document ticket: {error}"))?;
        let config = IrohDocsSyncConfig {
            version: CONFIG_VERSION,
            profile_id: profile.id.clone(),
            device_id: Uuid::now_v7().to_string(),
            vault_key: SyncPeerVaultKey::generate().to_base64(),
            write_doc_ticket: write_ticket.to_string(),
            peer_endpoint_ticket: None,
        };
        Ok::<_, String>((protocols, doc, author, config))
    })?;
    let node = finish_node(
        runtime,
        protocols,
        profile,
        config.clone(),
        doc,
        author,
        Vec::new(),
    )?;
    Ok((node, config))
}

async fn spawn_protocols(profile: &ActiveProfile) -> Result<SpawnedProtocols, String> {
    fs::create_dir_all(&profile.node_dir).map_err(|error| {
        format!(
            "Failed to create the Iroh Docs data directory '{}': {error}",
            profile.node_dir.display()
        )
    })?;
    protect_directory(&profile.node_dir)?;
    let identity = load_or_create_identity(&profile.node_dir.join(IDENTITY_FILE))?;
    let endpoint = Endpoint::builder(presets::N0)
        .secret_key(identity)
        .bind()
        .await
        .map_err(|error| format!("Failed to bind the Iroh Docs endpoint: {error}"))?;
    let endpoint_addr = endpoint.addr();
    let gossip = Gossip::builder().spawn(endpoint.clone());
    let store = FsStore::load(profile.node_dir.join("blobs"))
        .await
        .map_err(|error| format!("Failed to open the Iroh blob store: {error}"))?;
    let blobs = store.blobs().clone();
    let docs = Docs::persistent(profile.node_dir.join("docs"))
        .spawn(endpoint.clone(), (*store).clone(), gossip.clone())
        .await
        .map_err(|error| format!("Failed to open the Iroh document store: {error}"))?;
    let router = Router::builder(endpoint)
        .accept(BLOBS_ALPN, BlobsProtocol::new(&store, None))
        .accept(GOSSIP_ALPN, gossip)
        .accept(DOCS_ALPN, docs.clone())
        .spawn();
    Ok(SpawnedProtocols {
        router,
        docs,
        blobs,
        endpoint_addr,
    })
}

fn finish_node(
    runtime: tokio::runtime::Runtime,
    protocols: SpawnedProtocols,
    profile: ActiveProfile,
    config: IrohDocsSyncConfig,
    doc: Doc,
    author: AuthorId,
    peers: Vec<EndpointAddr>,
) -> Result<IrohDocsNode, String> {
    let events = runtime.block_on(async {
        let events = doc
            .subscribe()
            .await
            .map_err(|error| format!("Failed to subscribe to Iroh document events: {error}"))?;
        if !peers.is_empty() {
            doc.start_sync(peers.clone())
                .await
                .map_err(|error| format!("Failed to start Iroh document sync: {error}"))?;
        }
        Ok::<_, String>(events)
    })?;
    let context = Arc::new(SyncContext {
        profile,
        vault_key: SyncPeerVaultKey::from_base64(&config.vault_key)?,
        config,
        doc,
        blobs: protocols.blobs,
        author,
        peers,
        live: Arc::new(Mutex::new(LiveStatus {
            phase: "running".to_string(),
            ..LiveStatus::default()
        })),
        debounce_generation: AtomicU64::new(0),
    });
    spawn_event_loop(&runtime, context.clone(), events);
    let endpoint_ticket = EndpointTicket::new(protocols.endpoint_addr).to_string();
    Ok(IrohDocsNode {
        runtime,
        router: protocols.router,
        context,
        endpoint_ticket,
    })
}

fn spawn_event_loop(
    runtime: &tokio::runtime::Runtime,
    context: Arc<SyncContext>,
    mut events: impl n0_future::Stream<Item = anyhow::Result<LiveEvent>> + Send + Unpin + 'static,
) {
    runtime.spawn(async move {
        while let Some(event) = events.next().await {
            match event {
                Ok(LiveEvent::NeighborUp(_)) => update_neighbors(&context, 1),
                Ok(LiveEvent::NeighborDown(_)) => update_neighbors(&context, -1),
                Ok(LiveEvent::SyncFinished(event)) => {
                    if let Ok(mut live) = context.live.lock() {
                        live.last_sync_ms = now_ms();
                        if let Err(error) = event.result {
                            live.last_error = Some(error);
                        }
                    }
                }
                Ok(LiveEvent::PendingContentReady) => match apply_document_state(&context).await {
                    Ok(summary) => {
                        if summary.applied > 0 || summary.conflicts > 0 {
                            let _ = publish_local_state(&context).await;
                            notify_sync_listener();
                        }
                        set_phase(&context, "synced", None);
                    }
                    Err(error) => set_phase(&context, "error", Some(error)),
                },
                Ok(_) => {}
                Err(error) => set_phase(&context, "error", Some(error.to_string())),
            }
        }
    });
}

async fn export_pairing_material(
    node: &IrohDocsNode,
) -> Result<(IrohDocsPairingBundle, String), String> {
    let mut write_ticket = node
        .context
        .doc
        .share(ShareMode::Write, AddrInfoOptions::RelayAndAddresses)
        .await
        .map_err(|error| format!("Failed to export the trusted-device ticket: {error}"))?;
    if let Some(peer) = &node.context.config.peer_endpoint_ticket {
        write_ticket.nodes.push(parse_endpoint_ticket(peer)?);
        deduplicate_peers(&mut write_ticket.nodes);
    }
    let read_ticket = node
        .context
        .doc
        .share(ShareMode::Read, AddrInfoOptions::RelayAndAddresses)
        .await
        .map_err(|error| format!("Failed to export the read-only peer ticket: {error}"))?;
    Ok((
        IrohDocsPairingBundle {
            write_doc_ticket: write_ticket.to_string(),
            vault_key: node.context.config.vault_key.clone(),
            peer_endpoint_ticket: node.context.config.peer_endpoint_ticket.clone(),
        },
        read_ticket.to_string(),
    ))
}

async fn sync_once(context: Arc<SyncContext>) -> Result<IrohDocsSyncResult, String> {
    let mut events = context
        .doc
        .subscribe()
        .await
        .map_err(|error| format!("Failed to monitor Iroh sync progress: {error}"))?;
    if !context.peers.is_empty() {
        context
            .doc
            .start_sync(context.peers.clone())
            .await
            .map_err(|error| format!("Failed to contact Iroh sync peers: {error}"))?;
    }

    let before = apply_document_state(&context).await?;
    let published = publish_local_state(&context).await?;
    let mut result = IrohDocsSyncResult {
        published: published.published,
        unchanged: published.unchanged,
        tombstones: published.tombstones,
        applied: before.applied,
        conflicts: before.conflicts,
        ..IrohDocsSyncResult::default()
    };

    if !context.peers.is_empty() {
        let wait = async {
            while let Some(event) = events.next().await {
                match event.map_err(|error| error.to_string())? {
                    LiveEvent::SyncFinished(event) => {
                        result.connected = true;
                        if let Ok(details) = event.result {
                            result.entries_received += details.entries_received;
                            result.entries_sent += details.entries_sent;
                        }
                    }
                    LiveEvent::PendingContentReady => break,
                    _ => {}
                }
            }
            Ok::<(), String>(())
        };
        let _ = tokio::time::timeout(Duration::from_millis(MANUAL_SYNC_WAIT_MS), wait).await;
    }

    let after = apply_document_state(&context).await?;
    result.applied += after.applied;
    result.conflicts += after.conflicts;
    if after.applied > 0 || after.conflicts > 0 {
        let echoed = publish_local_state(&context).await?;
        result.published += echoed.published;
        result.unchanged += echoed.unchanged;
        result.tombstones += echoed.tombstones;
        notify_sync_listener();
    }
    if let Ok(mut live) = context.live.lock() {
        live.last_sync_ms = now_ms();
        live.last_error = None;
    }
    Ok(result)
}

async fn publish_local_state(context: &SyncContext) -> Result<PublishSummary, String> {
    let entries = load_document_entries(context).await?;
    let files = collect_syncable_files(&context.profile.root)?;
    let mut summary = PublishSummary::default();

    for (path, content) in &files {
        let object_id = opaque_sync_peer_file_id(&context.vault_key, path)?;
        let own = entries
            .get(&object_id)
            .and_then(|items| items.iter().find(|entry| entry.author == context.author));
        let content_hash = sha256_hex(content);
        if own
            .and_then(|entry| operation_content_hash(&entry.operation))
            .is_some_and(|hash| hash == content_hash)
        {
            summary.unchanged += 1;
            continue;
        }
        let base_hash = own.and_then(|entry| operation_content_hash(&entry.operation));
        let sequence = own.map(|entry| entry.operation.sequence + 1).unwrap_or(1);
        let operation = SyncPeerOperation::file_upsert(
            context.config.device_id.clone(),
            sequence,
            None,
            now_ms().unwrap_or(0),
            path.clone(),
            base_hash,
            content,
        )?;
        set_operation(context, &object_id, &operation).await?;
        summary.published += 1;
    }

    for (object_id, items) in entries {
        let Some(own) = items.iter().find(|entry| entry.author == context.author) else {
            continue;
        };
        let Some(path) = operation_path(&own.operation) else {
            continue;
        };
        if files.contains_key(path) || operation_is_delete(&own.operation) {
            continue;
        }
        let base_hash = operation_content_hash(&own.operation);
        let operation = SyncPeerOperation::filesystem_delete(
            context.config.device_id.clone(),
            own.operation.sequence + 1,
            None,
            now_ms().unwrap_or(0),
            path.to_string(),
            base_hash,
        )?;
        set_operation(context, &object_id, &operation).await?;
        summary.published += 1;
        summary.tombstones += 1;
    }
    Ok(summary)
}

async fn set_operation(
    context: &SyncContext,
    object_id: &str,
    operation: &SyncPeerOperation,
) -> Result<(), String> {
    let encrypted =
        encrypt_sync_peer_operation_for_object_id(&context.vault_key, object_id, operation)?;
    let bytes = encrypted.envelope.to_bytes()?;
    context
        .doc
        .set_bytes(context.author, object_id.as_bytes().to_vec(), bytes)
        .await
        .map_err(|error| format!("Failed to publish an encrypted filesystem entry: {error}"))?;
    Ok(())
}

async fn apply_document_state(context: &SyncContext) -> Result<ApplySummary, String> {
    let entries = load_document_entries(context).await?;
    let mut summary = ApplySummary::default();
    for items in entries.values() {
        let Some(winner) = items.iter().max_by(|left, right| {
            operation_order_key(&left.operation).cmp(&operation_order_key(&right.operation))
        }) else {
            continue;
        };
        let Some(path) = operation_path(&winner.operation) else {
            continue;
        };
        if !is_syncable_relative_path(path) {
            continue;
        }
        let relative = sanitize_relative(path)?;
        ensure_no_symlink_ancestors(&context.profile.root, &relative)?;
        let target = context.profile.root.join(&relative);
        let local = match fs::read(&target) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(format!("Failed to read '{}': {error}", target.display())),
        };

        match &winner.operation.payload {
            SyncPeerOperationPayload::FileUpsert {
                base_sha256,
                content_sha256,
                ..
            } => {
                let content = winner
                    .operation
                    .file_content()?
                    .ok_or_else(|| "Encrypted filesystem entry has no content.".to_string())?;
                if local
                    .as_deref()
                    .is_some_and(|bytes| sha256_hex(bytes) == *content_sha256)
                {
                    continue;
                }
                let can_fast_forward = match local.as_deref() {
                    None => true,
                    Some(bytes) => base_sha256
                        .as_ref()
                        .is_some_and(|base| *base == sha256_hex(bytes)),
                };
                if can_fast_forward {
                    atomic_write(&target, &content)?;
                    summary.applied += 1;
                } else {
                    let conflict = conflict_path(&target, content_sha256);
                    if fs::read(&conflict).ok().as_deref() != Some(content.as_slice()) {
                        atomic_write(&conflict, &content)?;
                        summary.conflicts += 1;
                    }
                }
            }
            SyncPeerOperationPayload::FilesystemDelete { base_sha256, .. } => {
                let Some(local) = local else {
                    continue;
                };
                if base_sha256
                    .as_ref()
                    .is_some_and(|base| *base == sha256_hex(&local))
                {
                    fs::remove_file(&target).map_err(|error| {
                        format!("Failed to apply deletion '{}': {error}", target.display())
                    })?;
                    summary.applied += 1;
                } else {
                    summary.conflicts += 1;
                }
            }
            SyncPeerOperationPayload::MacDurabilityReceipt { .. } => {}
        }
    }
    Ok(summary)
}

async fn load_document_entries(
    context: &SyncContext,
) -> Result<HashMap<String, Vec<StoredOperation>>, String> {
    let mut grouped: HashMap<String, Vec<StoredOperation>> = HashMap::new();
    let mut stream = context
        .doc
        .get_many(Query::all())
        .await
        .map_err(|error| format!("Failed to read the Iroh document index: {error}"))?;
    while let Some(entry) = stream.next().await {
        let entry =
            entry.map_err(|error| format!("Failed to read an Iroh document entry: {error}"))?;
        if entry.content_len() == 0 || entry.content_len() > MAX_ENVELOPE_BYTES {
            continue;
        }
        let Ok(object_id) = std::str::from_utf8(entry.key()) else {
            continue;
        };
        let bytes = context
            .blobs
            .get_bytes(entry.content_hash())
            .await
            .map_err(|error| format!("Failed to read encrypted Iroh content: {error}"))?;
        let envelope = EncryptedSyncPeerEnvelope::from_bytes(&bytes)?;
        let operation = decrypt_sync_peer_operation(&context.vault_key, object_id, &envelope)?;
        let Some(path) = operation_path(&operation) else {
            continue;
        };
        if opaque_sync_peer_file_id(&context.vault_key, path)? != object_id {
            continue;
        }
        grouped
            .entry(object_id.to_string())
            .or_default()
            .push(StoredOperation {
                author: entry.author(),
                operation,
            });
    }
    Ok(grouped)
}

fn collect_syncable_files(root: &Path) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let mut files = BTreeMap::new();
    collect_syncable_files_inner(root, root, &mut files)?;
    Ok(files)
}

fn collect_syncable_files_inner(
    root: &Path,
    directory: &Path,
    files: &mut BTreeMap<String, Vec<u8>>,
) -> Result<(), String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| format!("Failed to scan '{}': {error}", directory.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if file_type.is_dir() {
            let first = relative.split('/').next().unwrap_or_default();
            if first == ".git"
                || first == RECORDINGS_STORAGE_FOLDER
                || first == ATTACHMENTS_STORAGE_FOLDER
            {
                continue;
            }
            collect_syncable_files_inner(root, &path, files)?;
        } else if file_type.is_file() && is_syncable_relative_path(&relative) {
            let metadata = entry.metadata().map_err(|error| error.to_string())?;
            if metadata.len() > MAX_ENVELOPE_BYTES {
                continue;
            }
            files.insert(
                relative,
                fs::read(&path)
                    .map_err(|error| format!("Failed to read '{}': {error}", path.display()))?,
            );
        }
    }
    Ok(())
}

fn is_syncable_relative_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let lower = normalized.to_ascii_lowercase();
    lower.ends_with(".md")
        || lower.ends_with("/.notes-order.json")
        || lower == ".notes-order.json"
        || lower == ".type/settings.json"
}

fn operation_path(operation: &SyncPeerOperation) -> Option<&str> {
    match &operation.payload {
        SyncPeerOperationPayload::FileUpsert { path, .. }
        | SyncPeerOperationPayload::FilesystemDelete { path, .. } => Some(path),
        SyncPeerOperationPayload::MacDurabilityReceipt { .. } => None,
    }
}

fn operation_content_hash(operation: &SyncPeerOperation) -> Option<String> {
    match &operation.payload {
        SyncPeerOperationPayload::FileUpsert { content_sha256, .. } => Some(content_sha256.clone()),
        _ => None,
    }
}

fn operation_is_delete(operation: &SyncPeerOperation) -> bool {
    matches!(
        &operation.payload,
        SyncPeerOperationPayload::FilesystemDelete { .. }
    )
}

fn operation_order_key(operation: &SyncPeerOperation) -> (i64, u64, &str) {
    (
        operation.created_at_ms,
        operation.sequence,
        operation.device_id.as_str(),
    )
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Missing parent for '{}'.", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let temporary = parent.join(format!(".{file_name}.type-sync-{}.tmp", Uuid::now_v7()));
    fs::write(&temporary, bytes)
        .map_err(|error| format!("Failed to write '{}': {error}", temporary.display()))?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Failed to replace '{}': {error}", path.display()));
    }
    Ok(())
}

fn conflict_path(path: &Path, content_hash: &str) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("note");
    let suffix = &content_hash[..content_hash.len().min(8)];
    match path.extension().and_then(|value| value.to_str()) {
        Some(extension) => parent.join(format!("{stem}.conflict-{suffix}.{extension}")),
        None => parent.join(format!("{stem}.conflict-{suffix}")),
    }
}

fn ensure_no_symlink_ancestors(root: &Path, relative: &Path) -> Result<(), String> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!(
                    "Refusing to sync through symlink '{}'.",
                    current.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn active_profile(app: &AppEnv) -> Result<ActiveProfile, String> {
    let state = ensure_profiles_state(app)?;
    let profile = find_profile(&state, &state.active_profile_id)
        .or_else(|| state.profiles.first())
        .ok_or_else(|| "No profiles configured.".to_string())?;
    let digest = sha256_hex(profile.id.as_bytes());
    let node_dir = app_data_dir(app)?.join(SYNC_FOLDER).join(digest);
    Ok(ActiveProfile {
        id: profile.id.clone(),
        root: PathBuf::from(&profile.notes_root),
        node_dir,
    })
}

fn config_path(profile: &ActiveProfile) -> PathBuf {
    profile.node_dir.join(CONFIG_FILE)
}

fn read_config(profile: &ActiveProfile) -> Result<Option<IrohDocsSyncConfig>, String> {
    let path = config_path(profile);
    if !path.exists() {
        return Ok(None);
    }
    let bytes =
        fs::read(&path).map_err(|error| format!("Failed to read Iroh Docs config: {error}"))?;
    let config = serde_json::from_slice::<IrohDocsSyncConfig>(&bytes)
        .map_err(|error| format!("Invalid Iroh Docs config: {error}"))?;
    validate_config(profile, &config)?;
    Ok(Some(config))
}

fn write_config(profile: &ActiveProfile, config: &IrohDocsSyncConfig) -> Result<(), String> {
    fs::create_dir_all(&profile.node_dir).map_err(|error| error.to_string())?;
    protect_directory(&profile.node_dir)?;
    let bytes = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    write_private_file(&config_path(profile), &bytes)
}

fn validate_config(profile: &ActiveProfile, config: &IrohDocsSyncConfig) -> Result<(), String> {
    if config.version != CONFIG_VERSION {
        return Err("Unsupported Iroh Docs sync config version.".to_string());
    }
    if config.profile_id != profile.id {
        return Err("Iroh Docs sync config belongs to another profile.".to_string());
    }
    if config.device_id.trim().is_empty() {
        return Err("Iroh Docs sync device id is missing.".to_string());
    }
    SyncPeerVaultKey::from_base64(&config.vault_key)?;
    parse_write_ticket(&config.write_doc_ticket)?;
    if let Some(peer) = &config.peer_endpoint_ticket {
        parse_endpoint_ticket(peer)?;
    }
    Ok(())
}

fn parse_write_ticket(value: &str) -> Result<DocTicket, String> {
    let ticket = DocTicket::from_str(value.trim())
        .map_err(|error| format!("Invalid Iroh document ticket: {error}"))?;
    if !matches!(&ticket.capability, Capability::Write(_)) {
        return Err("Trusted Type devices require a write-capable document ticket.".to_string());
    }
    Ok(ticket)
}

fn parse_endpoint_ticket(value: &str) -> Result<EndpointAddr, String> {
    EndpointTicket::from_str(value.trim())
        .map(|ticket| ticket.endpoint_addr().clone())
        .map_err(|error| format!("Invalid Iroh peer endpoint ticket: {error}"))
}

fn normalize_peer_ticket(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value.map(|value| value.trim().to_string()) else {
        return Ok(None);
    };
    if value.is_empty() {
        return Ok(None);
    }
    parse_endpoint_ticket(&value)?;
    Ok(Some(value))
}

fn deduplicate_peers(peers: &mut Vec<EndpointAddr>) {
    let mut deduplicated = Vec::new();
    for peer in peers.drain(..) {
        if !deduplicated
            .iter()
            .any(|known: &EndpointAddr| known.id == peer.id)
        {
            deduplicated.push(peer);
        }
    }
    *peers = deduplicated;
}

fn load_or_create_identity(path: &Path) -> Result<SecretKey, String> {
    if path.exists() {
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        let bytes: [u8; 32] = bytes
            .try_into()
            .map_err(|_| "Stored Iroh Docs identity has an invalid length.".to_string())?;
        return Ok(SecretKey::from_bytes(&bytes));
    }
    let identity = SecretKey::generate();
    write_private_file(path, &identity.to_bytes())?;
    Ok(identity)
}

fn protect_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn write_private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::write(path, bytes).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn sync_runtime() -> Result<tokio::runtime::Runtime, String> {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .worker_threads(2)
        .thread_name("type-iroh-docs")
        .build()
        .map_err(|error| format!("Failed to create the Iroh Docs runtime: {error}"))
}

fn stop_wrong_profile(guard: &mut Option<IrohDocsNode>, profile_id: &str) {
    if guard
        .as_ref()
        .is_some_and(|node| node.context.profile.id != profile_id)
    {
        if let Some(node) = guard.take() {
            node.stop();
        }
    }
}

fn disabled_status(profile_id: String) -> IrohDocsSyncStatus {
    IrohDocsSyncStatus {
        configured: false,
        running: false,
        profile_id,
        document_id: None,
        endpoint_id: None,
        peer_configured: false,
        phase: "disabled".to_string(),
        last_sync_ms: None,
        last_error: None,
        neighbors: 0,
    }
}

fn set_phase(context: &SyncContext, phase: &str, error: Option<String>) {
    if let Ok(mut live) = context.live.lock() {
        live.phase = phase.to_string();
        live.last_error = error;
    }
}

fn update_neighbors(context: &SyncContext, delta: isize) {
    if let Ok(mut live) = context.live.lock() {
        live.neighbors = if delta.is_negative() {
            live.neighbors.saturating_sub(delta.unsigned_abs())
        } else {
            live.neighbors.saturating_add(delta as usize)
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("type-iroh-docs-{label}-{}", Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn scanner_only_includes_shareable_files() {
        let root = temp_root("scanner");
        fs::create_dir_all(root.join("Feed")).unwrap();
        fs::create_dir_all(root.join("Recordings")).unwrap();
        fs::create_dir_all(root.join(".type")).unwrap();
        fs::write(root.join("Feed/note.md"), b"note").unwrap();
        fs::write(root.join("Feed/.notes-order.json"), b"{}").unwrap();
        fs::write(root.join("Recordings/audio.m4a"), b"audio").unwrap();
        fs::write(root.join(".type/settings.json"), b"{}").unwrap();
        fs::write(root.join(".type/device.json"), b"secret").unwrap();

        let files = collect_syncable_files(&root).unwrap();
        assert_eq!(
            files.keys().cloned().collect::<Vec<_>>(),
            [
                ".type/settings.json".to_string(),
                "Feed/.notes-order.json".to_string(),
                "Feed/note.md".to_string(),
            ]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn conflict_names_are_deterministic_and_keep_extensions() {
        let path = Path::new("Feed/note.md");
        assert_eq!(
            conflict_path(path, "0123456789abcdef"),
            PathBuf::from("Feed/note.conflict-01234567.md")
        );
    }
}
