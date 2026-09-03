//! SSH-over-Iroh transport plus content-addressed recording transfer.
//!
//! Git and SSH remain completely unaware of Iroh. The desktop accepts Iroh
//! streams and forwards them to the embedded SSH server on loopback. The phone
//! exposes a loopback TCP listener and forwards each libgit2 SSH connection to
//! the desktop's Iroh endpoint. Recording bytes are provided by `iroh-blobs`;
//! the custom Type stream carries only a small path/hash offer and receipt.
//!
//! Two rules keep this reliable — see `docs/IROH_SYNC_EXPERIMENT.md`:
//!
//! 1. **A handler must not return while the peer still needs the connection.**
//!    iroh's `Router` drops the `Connection` the moment `ProtocolHandler::accept`
//!    returns, and a dropped QUIC connection discards everything it has not yet
//!    had acknowledged. A handler that replies and returns therefore races its
//!    own reply away. The desktop serves streams in a loop until the peer closes
//!    instead.
//! 2. **The phone keeps one connection per computer.** Every tunnelled git
//!    connection, the pairing check, and each audio offer is a separate QUIC
//!    stream on it. That removes a per-connection handshake and means no reply
//!    can race a connection teardown.

use crate::{app_data_dir, AppEnv};
use iroh::{
    endpoint::{presets, Connection, RecvStream, SendStream},
    protocol::{AcceptError, ProtocolHandler, Router},
    Endpoint, EndpointAddr, EndpointId, SecretKey,
};
use iroh_blobs::{
    api::{Store as BlobStore, TempTag},
    store::fs::FsStore,
    ticket::BlobTicket,
    BlobFormat, BlobsProtocol,
};
use iroh_tickets::endpoint::EndpointTicket;
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    str::FromStr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

const IROH_ALPN: &[u8] = b"type/ssh-tunnel/1";
const IROH_SSH_HANDSHAKE: &[u8; 5] = b"type1";
const IROH_AUDIO_HANDSHAKE: &[u8; 5] = b"aud02";
const IROH_PAIR_HANDSHAKE: &[u8; 5] = b"pair1";
const MAX_AUDIO_HEADER_BYTES: usize = 16 * 1024;
const MAX_AUDIO_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_PAIRING_TOKEN_BYTES: usize = 128;
const IROH_ENDPOINTS_FILE: &str = "iroh_endpoints.json";
pub const IROH_CLIENT_PROXY_PORT: u16 = 19_418;

/// Budget for the first dial, which uses the addresses the pairing QR carried.
/// On the same network this resolves in milliseconds; through a relay it is a
/// wide-area round trip, so the budget is generous rather than snappy.
const IROH_DIAL_TIMEOUT: Duration = Duration::from_secs(20);
/// Budget for the second dial, which resolves the computer's current addresses
/// through iroh's pkarr/DNS lookup. Slower: it involves a lookup first.
const IROH_DISCOVERY_DIAL_TIMEOUT: Duration = Duration::from_secs(30);
/// How long the phone waits for a relay before publishing a blob ticket. Missing
/// the deadline is not fatal — the desktop can still find the phone by id.
const IROH_BLOB_PUBLISH_TIMEOUT: Duration = Duration::from_secs(20);
/// Budget for one recording's full offer-and-transfer round trip. Neither
/// `send_audio_blob_offer`'s ack read nor the desktop's blob fetch carry their
/// own timeout, so a stalled relay/NAT path can otherwise hang here forever —
/// this is what turns that into "skip this recording, try again next sync"
/// instead of blocking the whole archive (and, before the phase split below,
/// the whole push) indefinitely.
const IROH_AUDIO_TRANSFER_TIMEOUT: Duration = Duration::from_secs(60);
/// Same reasoning for the small pairing-check round trip: its ack read has no
/// timeout of its own.
const IROH_PAIRING_CHECK_TIMEOUT: Duration = Duration::from_secs(20);
/// QUIC application close code used for "we are done, nothing went wrong".
const IROH_CLOSE_OK: u32 = 0;

/// Arguments supplied by the mobile shell after scanning a pairing QR.
#[derive(Clone, Deserialize)]
pub struct StartIrohClientArgs {
    pub ticket: String,
    pub remote_url: String,
}

/// Loopback connection details returned to the mobile Git adapter, plus what
/// the phone's Sync screen reports about the direct connection.
#[derive(Clone, Serialize)]
pub struct IrohClientStatus {
    pub running: bool,
    pub local_port: u16,
    pub local_remote_url: String,
    /// The computer this phone tunnels to.
    pub endpoint_id: String,
    /// This phone's own endpoint id, which is what the computer authorizes.
    pub local_endpoint_id: String,
    /// Whether the computer has authorized this phone for out-of-band audio.
    /// Notes sync regardless — only recordings need this.
    pub paired: bool,
    /// Why the last pairing check said no, when it did.
    pub pair_error: Option<String>,
    /// How the last connection actually ran: "direct", "relay", or "unknown".
    pub connection: String,
    /// The last transport failure, so a git error can be explained in terms of
    /// the connection rather than of a loopback port.
    pub last_error: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct IrohAudioArchiveResult {
    pub scanned: usize,
    pub uploaded: usize,
    pub already_archived: usize,
    /// Recordings deliberately left on the phone this run — the computer has
    /// not authorized this phone for audio yet.
    pub skipped: usize,
    /// Recordings that were attempted but did not make it this run (timeout,
    /// dropped connection, …). They stay on the phone and are retried on the
    /// next sync — not a hard failure, so notes still synced.
    pub failed: usize,
    /// Why the last skip/failure happened. Not an error: notes still synced.
    pub error: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct AudioUploadHeader {
    audio_path: String,
    sha256: String,
    blake3: String,
    byte_length: u64,
    blob_ticket: String,
}

#[derive(Deserialize, Serialize)]
struct AudioUploadResponse {
    ok: bool,
    error: Option<String>,
    sha256: Option<String>,
    blake3: Option<String>,
    byte_length: Option<u64>,
}

// ── Desktop side ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct IrohServerAuth {
    /// The token the QR currently shows.
    pairing_token: Arc<Mutex<String>>,
    /// Tokens the SSH server retired in the last few minutes. A single QR scan
    /// pairs SSH *and* Iroh, and whichever lands first rotates the token — so
    /// the other must still be able to use it. This is the same list
    /// `ssh_server` keeps, shared rather than duplicated.
    consumed_pairing_tokens: Arc<Mutex<Vec<(String, Instant)>>>,
    endpoints_path: PathBuf,
    endpoints_lock: Arc<Mutex<()>>,
}

impl IrohServerAuth {
    fn is_authorized(&self, endpoint_id: &str) -> bool {
        let Ok(_guard) = self.endpoints_lock.lock() else {
            return false;
        };
        load_authorized_iroh_endpoints(&self.endpoints_path)
            .iter()
            .any(|allowed| allowed == endpoint_id)
    }

    fn token_matches(&self, supplied_token: &str) -> bool {
        if supplied_token.is_empty() {
            return false;
        }
        let current = self
            .pairing_token
            .lock()
            .map(|token| token.clone())
            .unwrap_or_default();
        if tokens_equal(&current, supplied_token) {
            return true;
        }
        let Ok(mut consumed) = self.consumed_pairing_tokens.lock() else {
            return false;
        };
        let now = Instant::now();
        consumed.retain(|(_, expires_at)| *expires_at > now);
        consumed
            .iter()
            .any(|(token, _)| tokens_equal(token, supplied_token))
    }

    /// Authorize `endpoint_id`, or confirm that it already is.
    ///
    /// An empty token means "just check": the phone sends one on every sync so
    /// its connection panel can say whether audio transfer will work, long
    /// after the QR token it paired with has rotated away.
    fn authorize_with_pairing_token(
        &self,
        endpoint_id: &str,
        supplied_token: &str,
    ) -> Result<(), String> {
        if self.is_authorized(endpoint_id) {
            return Ok(());
        }
        if !self.token_matches(supplied_token) {
            return Err("This phone is not paired for Iroh audio sync. Scan the QR again.".into());
        }
        let _guard = self
            .endpoints_lock
            .lock()
            .map_err(|_| "The Iroh paired-device store is unavailable.".to_string())?;
        register_authorized_iroh_endpoint(&self.endpoints_path, endpoint_id)
    }
}

fn tokens_equal(left: &str, right: &str) -> bool {
    !left.is_empty()
        && left.len() == right.len()
        && bool::from(left.as_bytes().ct_eq(right.as_bytes()))
}

/// Desktop-side endpoint owned by the embedded local-sync daemon.
pub struct IrohServerHandle {
    runtime: tokio::runtime::Runtime,
    router: Router,
    endpoint_id: String,
}

impl IrohServerHandle {
    /// Recomputed on every call rather than captured at startup. The address
    /// set grows when the relay attaches and changes when the machine moves
    /// networks; a ticket minted once goes stale and takes the QR with it.
    pub fn ticket(&self) -> String {
        EndpointTicket::new(self.router.endpoint().addr()).to_string()
    }

    pub fn endpoint_id(&self) -> &str {
        &self.endpoint_id
    }

    /// The home relay, once one has attached. `None` means this computer is
    /// still only reachable on its own network.
    pub fn relay_url(&self) -> Option<String> {
        self.router
            .endpoint()
            .addr()
            .relay_urls()
            .next()
            .map(|url| url.to_string())
    }

    pub fn stop(self) {
        let Self {
            runtime, router, ..
        } = self;
        let _ = runtime.block_on(router.shutdown());
        runtime.shutdown_background();
    }
}

#[derive(Clone, Debug)]
struct TypeSyncProtocol {
    target_port: u16,
    repo_root: PathBuf,
    endpoint: Endpoint,
    blobs: BlobStore,
    auth: IrohServerAuth,
}

impl ProtocolHandler for TypeSyncProtocol {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        serve_iroh_connection(connection, self.clone())
            .await
            .map_err(|error| AcceptError::from_err(std::io::Error::other(error)))
    }
}

/// Start the desktop endpoint and forward accepted streams to the SSH server.
///
/// Returns as soon as the socket is bound. Waiting for a relay here used to be
/// a precondition, which meant a slow first relay handshake produced a QR with
/// no Iroh ticket at all and silently downgraded the phone to LAN-only sync.
pub fn start_iroh_sync_server(
    app: &AppEnv,
    target_port: u16,
    repo_root: PathBuf,
    pairing_token: Arc<Mutex<String>>,
    consumed_pairing_tokens: Arc<Mutex<Vec<(String, Instant)>>>,
) -> Result<IrohServerHandle, String> {
    let secret = load_or_create_secret(app, "server.key")?;
    // The post-0.35 blob store is a rewrite with a different on-disk format.
    // Keep its cache isolated so an experimental upgrade cannot corrupt an
    // older store. Both are disposable caches; durable audio lives in notes.
    let blobs_path = blob_store_path(app, "server-blobs-v103")?;
    let auth = IrohServerAuth {
        pairing_token,
        consumed_pairing_tokens,
        endpoints_path: iroh_endpoints_path(app)?,
        endpoints_lock: Arc::new(Mutex::new(())),
    };
    let runtime = runtime("Iroh sync server")?;
    let router = runtime.block_on(async {
        let endpoint = Endpoint::builder(presets::N0)
            .secret_key(secret)
            .bind()
            .await
            .map_err(|error| format!("Failed to bind the Iroh sync endpoint: {error}"))?;
        let store = FsStore::load(blobs_path)
            .await
            .map_err(|error| format!("Failed to open the desktop Iroh blob store: {error}"))?;
        let store: BlobStore = store.into();
        let blobs = BlobsProtocol::new(&store, None);
        let sync = TypeSyncProtocol {
            target_port,
            repo_root,
            endpoint: endpoint.clone(),
            blobs: store,
            auth,
        };
        Ok::<Router, String>(
            Router::builder(endpoint)
                .accept(IROH_ALPN, sync)
                .accept(iroh_blobs::ALPN, blobs)
                .spawn(),
        )
    })?;

    let endpoint_id = router.endpoint().id().to_string();
    // A relay address is what makes the QR useful off this network. Waiting for
    // it in the background lets the QR appear immediately and upgrade itself:
    // `ticket()` is recomputed on every status poll.
    let relay_endpoint = router.endpoint().clone();
    let relay_id = endpoint_id.clone();
    runtime.spawn(async move {
        relay_endpoint.online().await;
        match relay_endpoint.addr().relay_urls().next() {
            Some(relay) => {
                eprintln!("[iroh-sync] desktop endpoint {relay_id} reachable via {relay}")
            }
            None => eprintln!("[iroh-sync] desktop endpoint {relay_id} is online without a relay"),
        }
    });

    eprintln!("[iroh-sync] desktop endpoint ready: {endpoint_id}");
    Ok(IrohServerHandle {
        runtime,
        router,
        endpoint_id,
    })
}

/// Serve every stream the peer opens, then return.
///
/// Returning ends the connection, so this loops until the peer closes it. That
/// is the whole fix for "the desktop did not acknowledge Iroh pairing:
/// connection lost": the reply is written, and the connection stays up long
/// enough for QUIC to actually deliver it.
async fn serve_iroh_connection(
    connection: Connection,
    protocol: TypeSyncProtocol,
) -> Result<(), String> {
    let remote_endpoint_id = connection.remote_id().to_string();
    eprintln!("[iroh-sync] desktop accepted connection from {remote_endpoint_id}");
    let mut streams = tokio::task::JoinSet::new();
    loop {
        // Reap finished stream tasks. A phone holds one connection for a whole
        // session and runs many syncs over it, so their handles would otherwise
        // pile up until it disconnects.
        while streams.try_join_next().is_some() {}
        let (send, recv) = match connection.accept_bi().await {
            Ok(pair) => pair,
            Err(error) => {
                eprintln!("[iroh-sync] desktop connection from {remote_endpoint_id} ended: {error}");
                break;
            }
        };
        let protocol = protocol.clone();
        let remote = remote_endpoint_id.clone();
        streams.spawn(async move {
            if let Err(error) = handle_iroh_stream(send, recv, protocol, remote.clone()).await {
                eprintln!("[iroh-sync] desktop stream from {remote} failed: {error}");
            }
        });
    }
    while streams.join_next().await.is_some() {}
    Ok(())
}

async fn handle_iroh_stream(
    send: SendStream,
    mut recv: RecvStream,
    protocol: TypeSyncProtocol,
    remote_endpoint_id: String,
) -> Result<(), String> {
    let mut handshake = [0u8; IROH_SSH_HANDSHAKE.len()];
    recv.read_exact(&mut handshake)
        .await
        .map_err(|error| format!("Iroh handshake failed: {error}"))?;
    if &handshake == IROH_PAIR_HANDSHAKE {
        return receive_iroh_pairing(send, recv, remote_endpoint_id, protocol.auth).await;
    }
    if &handshake == IROH_AUDIO_HANDSHAKE {
        return receive_audio_blob_offer(
            send,
            recv,
            protocol.repo_root,
            protocol.endpoint,
            protocol.blobs,
            remote_endpoint_id,
            protocol.auth,
        )
        .await;
    }
    if &handshake != IROH_SSH_HANDSHAKE {
        return Err("Iroh handshake was not recognized.".to_string());
    }
    let tcp = tokio::net::TcpStream::connect(("127.0.0.1", protocol.target_port))
        .await
        .map_err(|error| format!("Could not reach the desktop SSH server: {error}"))?;
    forward_bidi(tcp, send, recv).await
}

async fn receive_iroh_pairing(
    mut send: SendStream,
    mut recv: RecvStream,
    remote_endpoint_id: String,
    auth: IrohServerAuth,
) -> Result<(), String> {
    let token_len = recv
        .read_u16()
        .await
        .map_err(|error| format!("Could not read the Iroh pairing token: {error}"))?
        as usize;
    if token_len > MAX_PAIRING_TOKEN_BYTES {
        let _ = send.write_u8(0).await;
        let _ = send.finish();
        return Err("The Iroh pairing token has an invalid size.".to_string());
    }
    let mut token = vec![0u8; token_len];
    if token_len > 0 {
        recv.read_exact(&mut token)
            .await
            .map_err(|error| format!("Could not read the Iroh pairing token: {error}"))?;
    }
    let token =
        String::from_utf8(token).map_err(|_| "The Iroh pairing token is invalid.".to_string())?;
    let result = auth.authorize_with_pairing_token(&remote_endpoint_id, &token);
    send.write_u8(u8::from(result.is_ok()))
        .await
        .map_err(|error| format!("Could not acknowledge Iroh pairing: {error}"))?;
    send.finish()
        .map_err(|error| format!("Could not finish Iroh pairing: {error}"))?;
    // A "no" is a routine answer to a check, not a stream failure — the phone
    // asks on every sync so it can report audio pairing in its Sync screen.
    match &result {
        Ok(()) => eprintln!("[iroh-sync] audio transfer authorized for {remote_endpoint_id}"),
        Err(error) => {
            eprintln!("[iroh-sync] audio transfer not authorized for {remote_endpoint_id}: {error}")
        }
    }
    Ok(())
}

async fn receive_audio_blob_offer(
    mut send: SendStream,
    mut recv: RecvStream,
    repo_root: PathBuf,
    endpoint: Endpoint,
    blobs: BlobStore,
    remote_endpoint_id: String,
    auth: IrohServerAuth,
) -> Result<(), String> {
    let result = receive_audio_blob_inner(
        &mut recv,
        &repo_root,
        &endpoint,
        &blobs,
        &remote_endpoint_id,
        &auth,
    )
    .await;
    let response = match &result {
        Ok((sha256, blake3, byte_length)) => AudioUploadResponse {
            ok: true,
            error: None,
            sha256: Some(sha256.clone()),
            blake3: Some(blake3.clone()),
            byte_length: Some(*byte_length),
        },
        Err(error) => AudioUploadResponse {
            ok: false,
            error: Some(error.clone()),
            sha256: None,
            blake3: None,
            byte_length: None,
        },
    };
    let response_json = serde_json::to_vec(&response)
        .map_err(|error| format!("Failed to encode the audio acknowledgement: {error}"))?;
    send.write_u32(response_json.len() as u32)
        .await
        .map_err(|error| format!("Failed to send the audio acknowledgement: {error}"))?;
    send.write_all(&response_json)
        .await
        .map_err(|error| format!("Failed to send the audio acknowledgement: {error}"))?;
    send.finish()
        .map_err(|error| format!("Failed to finish the audio acknowledgement: {error}"))?;
    result.map(|_| ())
}

async fn receive_audio_blob_inner(
    recv: &mut RecvStream,
    repo_root: &Path,
    endpoint: &Endpoint,
    blobs: &BlobStore,
    remote_endpoint_id: &str,
    auth: &IrohServerAuth,
) -> Result<(String, String, u64), String> {
    let header_len = recv
        .read_u32()
        .await
        .map_err(|error| format!("Could not read the audio archive header: {error}"))?
        as usize;
    if header_len == 0 || header_len > MAX_AUDIO_HEADER_BYTES {
        return Err("The audio archive header has an invalid size.".to_string());
    }
    let mut header_json = vec![0u8; header_len];
    recv.read_exact(&mut header_json)
        .await
        .map_err(|error| format!("Could not read the audio archive header: {error}"))?;
    let header: AudioUploadHeader = serde_json::from_slice(&header_json)
        .map_err(|error| format!("The audio archive header is invalid: {error}"))?;
    if !auth.is_authorized(remote_endpoint_id) {
        return Err("This Iroh endpoint is not paired for audio sync. Scan the QR again.".into());
    }
    if header.byte_length > MAX_AUDIO_BYTES {
        return Err("The audio archive exceeds the 2 GiB safety limit.".to_string());
    }
    let relative = crate::sanitize_relative(&header.audio_path)?;
    let target = repo_root.join(&relative);
    if !crate::is_recording_audio_path_allowed(repo_root, &target) {
        return Err("Only recording audio paths can be archived.".to_string());
    }
    let repo = git2::Repository::open(repo_root)
        .map_err(|error| format!("The desktop notes Git repo is unavailable: {error}"))?;
    crate::set_audio_git_exclusion(&repo, true)?;
    let ticket = BlobTicket::from_str(&header.blob_ticket)
        .map_err(|error| format!("The recording blob ticket is invalid: {error}"))?;
    if ticket.format() != BlobFormat::Raw || ticket.hash().to_string() != header.blake3 {
        return Err("The recording blob ticket does not match its declared hash.".to_string());
    }
    if target.exists() {
        let existing_path = target.clone();
        let (sha256, byte_length) =
            tokio::task::spawn_blocking(move || crate::hash_file(&existing_path))
                .await
                .map_err(|error| format!("Desktop audio verification worker failed: {error}"))??;
        if sha256 != header.sha256 || byte_length != header.byte_length {
            return Err("The desktop already has different audio at this path.".to_string());
        }
        return Ok((sha256, header.blake3, byte_length));
    }
    let parent = target
        .parent()
        .ok_or_else(|| "The audio archive path has no parent.".to_string())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| format!("Could not create the desktop audio folder: {error}"))?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The audio archive filename is invalid.".to_string())?;
    let temporary = parent.join(format!(".{file_name}.iroh-{}.part", Uuid::now_v7()));
    let blob_connection = endpoint
        .connect(ticket.addr().clone(), iroh_blobs::ALPN)
        .await
        .map_err(|error| format!("Could not reach the phone's recording blob: {error}"))?;
    tokio::time::timeout(
        IROH_AUDIO_TRANSFER_TIMEOUT,
        blobs.remote().fetch(blob_connection, ticket.hash()),
    )
    .await
    .map_err(|_| "Downloading the recording blob timed out.".to_string())?
    .map_err(|error| format!("Could not download the recording blob: {error}"))?;
    blobs
        .blobs()
        .export(ticket.hash(), temporary.clone())
        .await
        .map_err(|error| format!("Could not export the recording blob: {error}"))?;
    let verify_path = temporary.clone();
    let verified = tokio::task::spawn_blocking(move || crate::hash_file(&verify_path)).await;
    let (sha256, byte_length) = match verified {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(error);
        }
        Err(error) => {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(format!("Audio verification worker failed: {error}"));
        }
    };
    if sha256 != header.sha256 || byte_length != header.byte_length {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err("The received audio hash does not match the phone.".to_string());
    }
    if let Err(error) = tokio::fs::rename(&temporary, &target).await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(format!(
            "Could not finalize the desktop audio archive: {error}"
        ));
    }
    Ok((sha256, header.blake3, byte_length))
}

// ── Phone side ───────────────────────────────────────────────────────────────

/// Where the phone dials, and the two ways it can get there.
#[derive(Clone)]
struct RemoteTarget {
    /// Everything the pairing ticket knew: the relay plus direct addresses, as
    /// they were when the QR was generated.
    addr: EndpointAddr,
    /// The computer's identity. Dialling this alone makes iroh resolve its
    /// *current* addresses through pkarr/DNS, which is what keeps a pairing
    /// working after the computer changed networks.
    id: EndpointId,
}

#[derive(Clone, Default)]
struct ClientDiagnostics {
    paired: bool,
    pair_error: Option<String>,
    connection: Option<&'static str>,
    last_error: Option<String>,
}

/// Everything a tunnelled connection needs, cheap to clone into a task.
#[derive(Clone)]
struct IrohDialer {
    endpoint: Endpoint,
    remote: Arc<Mutex<RemoteTarget>>,
    /// One shared connection per computer. Cached so git streams, the pairing
    /// check, and audio offers all multiplex onto it.
    connection: Arc<tokio::sync::Mutex<Option<Connection>>>,
    diagnostics: Arc<Mutex<ClientDiagnostics>>,
}

impl IrohDialer {
    fn target(&self) -> Result<RemoteTarget, String> {
        self.remote
            .lock()
            .map(|target| target.clone())
            .map_err(|_| "The direct-sync target is unavailable.".to_string())
    }

    fn diagnostics(&self) -> ClientDiagnostics {
        self.diagnostics
            .lock()
            .map(|state| state.clone())
            .unwrap_or_default()
    }

    fn update<F: FnOnce(&mut ClientDiagnostics)>(&self, update: F) {
        if let Ok(mut state) = self.diagnostics.lock() {
            update(&mut state);
        }
    }

    fn record_error(&self, error: &str) {
        self.update(|state| state.last_error = Some(error.to_string()));
    }

    /// Note whether the live connection runs over a direct path or the relay.
    /// Holepunching finishes after the handshake, so this is re-read on reuse
    /// rather than only when the connection is created.
    fn record_path(&self, connection: &Connection) {
        let label = {
            let paths = connection.paths();
            let selected = paths
                .iter()
                .find(|path| path.is_selected())
                .or_else(|| paths.iter().next());
            match selected {
                Some(path) if path.is_ip() => "direct",
                Some(path) if path.is_relay() => "relay",
                _ => "unknown",
            }
        };
        self.update(|state| state.connection = Some(label));
    }

    async fn connection(&self) -> Result<Connection, String> {
        let mut guard = self.connection.lock().await;
        if let Some(existing) = guard.as_ref() {
            if existing.close_reason().is_none() {
                self.record_path(existing);
                // Holding a live connection means the transport is fine right
                // now. Leaving a stale failure here would let the phone blame
                // the network for an unrelated git or auth error later on.
                self.update(|state| state.last_error = None);
                return Ok(existing.clone());
            }
        }
        let target = self.target()?;
        let connection = self.dial(&target).await?;
        *guard = Some(connection.clone());
        Ok(connection)
    }

    /// Whether a usable connection is already open, without dialling one.
    fn has_live_connection(&self) -> bool {
        self.connection
            .try_lock()
            .ok()
            .and_then(|guard| {
                guard
                    .as_ref()
                    .map(|connection| connection.close_reason().is_none())
            })
            .unwrap_or(false)
    }

    /// Drop the cached connection so the next use dials again.
    async fn reset(&self) {
        let mut guard = self.connection.lock().await;
        if let Some(connection) = guard.take() {
            connection.close(IROH_CLOSE_OK.into(), b"reset");
        }
    }

    async fn dial(&self, target: &RemoteTarget) -> Result<Connection, String> {
        let short = short_endpoint_id(&target.id);
        let mut failures = Vec::new();
        if !target.addr.is_empty() {
            eprintln!("[iroh-sync] dialing computer {short} on its paired addresses");
            match tokio::time::timeout(
                IROH_DIAL_TIMEOUT,
                self.endpoint.connect(target.addr.clone(), IROH_ALPN),
            )
            .await
            {
                Ok(Ok(connection)) => {
                    self.record_path(&connection);
                    self.update(|state| state.last_error = None);
                    eprintln!("[iroh-sync] connected to computer {short} on a paired address");
                    return Ok(connection);
                }
                Ok(Err(error)) => failures.push(format!("paired address: {error}")),
                Err(_) => failures.push(format!(
                    "paired address: no answer within {}s",
                    IROH_DIAL_TIMEOUT.as_secs()
                )),
            }
        }
        // Second attempt: identity only. iroh looks the computer up through the
        // n0 pkarr/DNS service, so a pairing made on another network still
        // reaches it after it moved.
        eprintln!("[iroh-sync] dialing computer {short} through address lookup");
        match tokio::time::timeout(
            IROH_DISCOVERY_DIAL_TIMEOUT,
            self.endpoint.connect(target.id, IROH_ALPN),
        )
        .await
        {
            Ok(Ok(connection)) => {
                self.record_path(&connection);
                self.update(|state| state.last_error = None);
                eprintln!("[iroh-sync] connected to computer {short} through address lookup");
                Ok(connection)
            }
            Ok(Err(error)) => {
                failures.push(format!("address lookup: {error}"));
                Err(self.unreachable(failures))
            }
            Err(_) => {
                failures.push(format!(
                    "address lookup: no answer within {}s",
                    IROH_DISCOVERY_DIAL_TIMEOUT.as_secs()
                ));
                Err(self.unreachable(failures))
            }
        }
    }

    fn unreachable(&self, failures: Vec<String>) -> String {
        let message = format!(
            "Could not reach the computer over the direct connection ({}). Open Type on the computer and make sure its sync server is running.",
            failures.join("; ")
        );
        self.record_error(&message);
        message
    }
}

struct IrohClientHandle {
    runtime: tokio::runtime::Runtime,
    router: Router,
    blobs: BlobStore,
    dialer: IrohDialer,
    local_endpoint_id: String,
    local_port: u16,
}

impl IrohClientHandle {
    fn status_for_remote(&self, remote_url: &str) -> Result<IrohClientStatus, String> {
        let diagnostics = self.dialer.diagnostics();
        let target = self.dialer.target()?;
        Ok(IrohClientStatus {
            running: true,
            local_port: self.local_port,
            local_remote_url: rewrite_ssh_remote_to_loopback(remote_url, self.local_port)?,
            endpoint_id: target.id.to_string(),
            local_endpoint_id: self.local_endpoint_id.clone(),
            paired: diagnostics.paired,
            pair_error: diagnostics.pair_error,
            connection: diagnostics.connection.unwrap_or("unknown").to_string(),
            last_error: diagnostics.last_error,
        })
    }

    /// Point at a (possibly different) computer. A new identity invalidates
    /// both the cached connection and everything we knew about pairing.
    fn set_target(&self, target: RemoteTarget) {
        let new_id = target.id;
        let previous = {
            let Ok(mut current) = self.dialer.remote.lock() else {
                return;
            };
            let previous = current.id;
            *current = target;
            previous
        };
        if previous != new_id {
            self.runtime.block_on(self.dialer.reset());
            self.dialer
                .update(|state| *state = ClientDiagnostics::default());
        }
    }

    /// Ask the computer whether this phone may send audio out of band.
    ///
    /// Never fails the caller: notes sync through the SSH tunnel whatever the
    /// answer is, and a phone that cannot pair should still be able to write.
    fn refresh_pairing(&self, pairing_token: &str) {
        // Never dial merely to ask. With a QR token in hand this is the pairing
        // itself and must run; otherwise it is a status question worth asking
        // only over a link that already exists. Dialling here would double the
        // wait whenever the computer is off — once for this question and again
        // for the sync that follows — on every capture the phone auto-syncs.
        if pairing_token.is_empty()
            && (self.dialer.diagnostics().paired || !self.dialer.has_live_connection())
        {
            return;
        }
        self.run_pairing_check(pairing_token);
    }

    /// Settle the audio question now, dialling if that is what it takes. The
    /// archive path calls this because it is about to need the connection
    /// anyway, so the answer costs nothing extra there — and without it a
    /// properly paired phone would keep falling back to Git after every launch.
    fn ensure_pairing_checked(&self) {
        if self.dialer.diagnostics().paired {
            return;
        }
        self.run_pairing_check("");
    }

    fn run_pairing_check(&self, pairing_token: &str) {
        let outcome = self.runtime.block_on(async {
            tokio::time::timeout(
                IROH_PAIRING_CHECK_TIMEOUT,
                check_iroh_pairing(&self.dialer, pairing_token),
            )
            .await
            .unwrap_or_else(|_| {
                Err(format!(
                    "The pairing check did not answer within {}s.",
                    IROH_PAIRING_CHECK_TIMEOUT.as_secs()
                ))
            })
        });
        match outcome {
            Ok(()) => self.dialer.update(|state| {
                state.paired = true;
                state.pair_error = None;
            }),
            Err(error) => {
                eprintln!("[iroh-sync] audio pairing check failed: {error}");
                self.dialer.update(|state| {
                    state.paired = false;
                    state.pair_error = Some(error);
                });
            }
        }
    }

    fn stop(self) {
        let Self {
            runtime, router, ..
        } = self;
        let _ = runtime.block_on(router.shutdown());
        runtime.shutdown_background();
    }
}

static CLIENT: Mutex<Option<IrohClientHandle>> = Mutex::new(None);

/// Start (or re-point) the phone's loopback proxy for an Iroh pairing.
///
/// The proxy is created once per process and then reused: rebinding the fixed
/// loopback port on every ticket change used to race the previous runtime's
/// shutdown and fail with "address already in use".
pub fn start_iroh_sync_client(
    app: &AppEnv,
    args: StartIrohClientArgs,
) -> Result<IrohClientStatus, String> {
    let target = remote_target_from_args(&args)?;
    let pairing_token = pairing_token_from_ssh_remote(&args.remote_url).unwrap_or_default();

    let mut guard = CLIENT
        .lock()
        .map_err(|_| "Iroh client state is poisoned.".to_string())?;
    if guard.is_none() {
        *guard = Some(create_iroh_client(app, target.clone())?);
    }
    let client = guard
        .as_ref()
        .ok_or_else(|| "The Iroh sync client is unavailable.".to_string())?;
    client.set_target(target);
    client.refresh_pairing(&pairing_token);
    let status = client.status_for_remote(&args.remote_url)?;
    eprintln!(
        "[iroh-sync] phone proxy ready on 127.0.0.1:{} for computer {} (audio paired: {})",
        status.local_port, status.endpoint_id, status.paired
    );
    Ok(status)
}

/// What the phone knows about its direct connection right now. Drives the Sync
/// screen's connection panel, and lets a git failure be explained in terms of
/// the computer rather than of a loopback port.
pub fn iroh_client_status(remote_url: &str) -> Result<Option<IrohClientStatus>, String> {
    let guard = CLIENT
        .lock()
        .map_err(|_| "Iroh client state is poisoned.".to_string())?;
    guard
        .as_ref()
        .map(|client| client.status_for_remote(remote_url))
        .transpose()
}

fn remote_target_from_args(args: &StartIrohClientArgs) -> Result<RemoteTarget, String> {
    let ticket = args.ticket.trim();
    if ticket.is_empty() {
        return Err("The Iroh endpoint ticket is empty.".to_string());
    }
    let parsed = EndpointTicket::from_str(ticket)
        .map_err(|error| format!("The Iroh endpoint ticket is invalid: {error}"))?;
    let addr = parsed.endpoint_addr().clone();
    // The ticket always carries the computer's identity alongside the addresses
    // it happened to have when the QR was drawn. Keeping the two apart is what
    // lets a stale address set fall back to an address lookup.
    let id = addr.id;
    Ok(RemoteTarget { addr, id })
}

fn create_iroh_client(app: &AppEnv, target: RemoteTarget) -> Result<IrohClientHandle, String> {
    let secret = load_or_create_secret(app, "client.key")?;
    let blobs_path = blob_store_path(app, "client-blobs-v103")?;
    let runtime = runtime("Iroh sync client")?;
    let (router, blobs, listener) = runtime.block_on(async {
        let endpoint = Endpoint::builder(presets::N0)
            .secret_key(secret)
            .bind()
            .await
            .map_err(|error| format!("Failed to bind the Iroh client endpoint: {error}"))?;
        let store = FsStore::load(blobs_path)
            .await
            .map_err(|error| format!("Failed to open the phone Iroh blob store: {error}"))?;
        let store: BlobStore = store.into();
        let blobs = BlobsProtocol::new(&store, None);
        let router = Router::builder(endpoint)
            .accept(iroh_blobs::ALPN, blobs)
            .spawn();
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", IROH_CLIENT_PROXY_PORT))
            .await
            .map_err(|error| {
                format!(
                "Failed to start the phone sync proxy on port {IROH_CLIENT_PROXY_PORT}: {error}"
            )
            })?;
        Ok::<_, String>((router, store, listener))
    })?;

    let local_endpoint_id = router.endpoint().id().to_string();
    let dialer = IrohDialer {
        endpoint: router.endpoint().clone(),
        remote: Arc::new(Mutex::new(target)),
        connection: Arc::new(tokio::sync::Mutex::new(None)),
        diagnostics: Arc::new(Mutex::new(ClientDiagnostics::default())),
    };

    let accept_dialer = dialer.clone();
    runtime.spawn(async move {
        loop {
            let (tcp, peer) = match listener.accept().await {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("[iroh-sync] phone proxy stopped accepting connections: {error}");
                    break;
                }
            };
            let dialer = accept_dialer.clone();
            tokio::spawn(async move {
                if let Err(error) = forward_tcp_to_iroh(tcp, dialer).await {
                    eprintln!("[iroh-sync] phone tunnel for {peer} failed: {error}");
                }
            });
        }
    });

    Ok(IrohClientHandle {
        runtime,
        router,
        blobs,
        dialer,
        local_endpoint_id,
        local_port: IROH_CLIENT_PROXY_PORT,
    })
}

/// Offer every local audio attachment that does not yet have an exact desktop
/// acknowledgement. `iroh-blobs` serves and verifies the bytes; Type's own
/// stream carries only the destination path and receipt metadata. Audio never
/// enters Git; Markdown and transcripts continue through the SSH tunnel.
pub fn archive_mobile_audio_with_iroh(app: &AppEnv) -> Result<IrohAudioArchiveResult, String> {
    let root = crate::ensured_notes_root(app)?;
    let recordings = crate::collect_recording_notes(&root)?;
    let mut result = IrohAudioArchiveResult {
        scanned: recordings.len(),
        uploaded: 0,
        already_archived: 0,
        skipped: 0,
        failed: 0,
        error: None,
    };
    let guard = CLIENT
        .lock()
        .map_err(|_| "Iroh client state is poisoned.".to_string())?;
    let client = guard
        .as_ref()
        .ok_or_else(|| "Start the Iroh sync connection before archiving audio.".to_string())?;

    // Audio is the only part of sync that needs Iroh authorization. When the
    // computer has not authorized this phone, carry audio in Git as before
    // rather than excluding it and uploading nothing — otherwise the recordings
    // would simply never arrive.
    let pending = recordings
        .iter()
        .filter(|recording| recording.audio_path.is_file())
        .count();
    if pending > 0 {
        client.ensure_pairing_checked();
    }
    let diagnostics = client.dialer.diagnostics();
    if !diagnostics.paired {
        result.skipped = pending;
        result.error = Some(diagnostics.pair_error.unwrap_or_else(|| {
            "This phone is not paired for direct audio transfer. Scan the QR code in desktop Settings → Sync again.".to_string()
        }));
        let repo = crate::ensure_git_repo(&root)?;
        crate::set_audio_git_exclusion(&repo, false)?;
        return Ok(result);
    }

    for recording in recordings {
        if !recording.audio_path.is_file() {
            continue;
        }
        let (sha256, byte_length) = match crate::hash_file(&recording.audio_path) {
            Ok(value) => value,
            Err(error) => {
                eprintln!(
                    "[iroh-sync] could not hash recording {}: {error}",
                    recording.audio_rel
                );
                result.failed += 1;
                result.error = Some(error);
                continue;
            }
        };
        if crate::audio_has_desktop_ack(&root, &recording.audio_rel, &sha256, byte_length) {
            result.already_archived += 1;
            continue;
        }
        // Every network step for one recording — hashing for iroh-blobs,
        // offering it, and waiting on the desktop's ack — shares one timeout.
        // Neither `send_audio_blob_offer`'s ack read nor the desktop's blob
        // fetch has its own deadline, so without this a stalled relay/NAT path
        // hangs here indefinitely instead of moving on to the next recording
        // (or, before the sync phase split, blocking the whole push).
        let audio_rel = recording.audio_rel.clone();
        let outcome = client.runtime.block_on(tokio::time::timeout(
            IROH_AUDIO_TRANSFER_TIMEOUT,
            async {
                let (header, blob_tag) = prepare_audio_blob_offer(
                    client.router.endpoint(),
                    &client.blobs,
                    &recording.audio_path,
                    audio_rel.clone(),
                    sha256.clone(),
                    byte_length,
                )
                .await?;
                send_audio_blob_offer(&client.dialer, &header).await?;
                // The temporary tag keeps the source alive for the entire
                // transfer. Dropping it makes the imported cache entry
                // eligible for blob-store GC.
                drop(blob_tag);
                Ok::<(), String>(())
            },
        ));
        match outcome {
            Ok(Ok(())) => match crate::record_desktop_audio_ack(
                &root,
                audio_rel.clone(),
                sha256,
                byte_length,
            ) {
                Ok(()) => result.uploaded += 1,
                Err(error) => {
                    eprintln!("[iroh-sync] could not record archive receipt for {audio_rel}: {error}");
                    result.failed += 1;
                    result.error = Some(error);
                }
            },
            Ok(Err(error)) => {
                eprintln!("[iroh-sync] audio archive failed for {audio_rel}: {error}");
                result.failed += 1;
                result.error = Some(error);
            }
            Err(_) => {
                let message = format!(
                    "Sending recording '{audio_rel}' timed out after {}s; it will retry next sync.",
                    IROH_AUDIO_TRANSFER_TIMEOUT.as_secs()
                );
                eprintln!("[iroh-sync] {message}");
                result.failed += 1;
                result.error = Some(message);
            }
        }
    }

    let repo = crate::ensure_git_repo(&root)?;
    crate::set_audio_git_exclusion(&repo, true)?;
    Ok(result)
}

pub fn set_mobile_audio_git_exclusion(app: &AppEnv, enabled: bool) -> Result<(), String> {
    let root = crate::ensured_notes_root(app)?;
    let repo = crate::ensure_git_repo(&root)?;
    crate::set_audio_git_exclusion(&repo, enabled)
}

/// Stop the process-global phone proxy. Safe when no proxy is running.
pub fn shutdown_iroh_sync_client() {
    if let Ok(mut guard) = CLIENT.lock() {
        if let Some(client) = guard.take() {
            client.stop();
        }
    }
}

/// Open one stream on the shared connection, redialling once if the cached
/// connection turned out to be dead.
///
/// QUIC opens streams lazily, so the handshake bytes are written here: that is
/// what makes the desktop's `accept_bi` resolve before the payload (an SSH
/// greeting, say) exists.
async fn open_desktop_stream(
    dialer: &IrohDialer,
    handshake: &[u8; 5],
) -> Result<(SendStream, RecvStream), String> {
    let mut last_error = None;
    for attempt in 0..2 {
        if attempt > 0 {
            dialer.reset().await;
        }
        let connection = dialer.connection().await?;
        match connection.open_bi().await {
            Ok((mut send, recv)) => match send.write_all(handshake).await {
                Ok(()) => return Ok((send, recv)),
                Err(error) => last_error = Some(error.to_string()),
            },
            Err(error) => last_error = Some(error.to_string()),
        }
    }
    let message = format!(
        "Could not open a stream to the computer: {}",
        last_error.unwrap_or_else(|| "unknown error".to_string())
    );
    dialer.record_error(&message);
    Err(message)
}

async fn forward_tcp_to_iroh(tcp: tokio::net::TcpStream, dialer: IrohDialer) -> Result<(), String> {
    let (send, recv) = open_desktop_stream(&dialer, IROH_SSH_HANDSHAKE).await?;
    forward_bidi(tcp, send, recv).await
}

/// Ask the computer whether this phone may send audio out of band, handing over
/// the QR token while we still have one. An empty token is a plain check: the
/// computer answers yes when it already knows this endpoint.
async fn check_iroh_pairing(dialer: &IrohDialer, pairing_token: &str) -> Result<(), String> {
    let (mut send, mut recv) = open_desktop_stream(dialer, IROH_PAIR_HANDSHAKE).await?;
    let token = pairing_token.as_bytes();
    let token_len = u16::try_from(token.len())
        .map_err(|_| "The direct-sync pairing token is invalid.".to_string())?;
    send.write_u16(token_len)
        .await
        .map_err(|error| format!("Could not send the Iroh pairing token: {error}"))?;
    send.write_all(token)
        .await
        .map_err(|error| format!("Could not send the Iroh pairing token: {error}"))?;
    send.finish()
        .map_err(|error| format!("Could not finish Iroh pairing: {error}"))?;
    match recv
        .read_u8()
        .await
        .map_err(|error| format!("The computer did not answer the pairing check: {error}"))?
    {
        1 => Ok(()),
        _ => Err(
            "The computer has not paired this phone for audio transfer. Scan the QR code in desktop Settings → Sync again."
                .to_string(),
        ),
    }
}

async fn prepare_audio_blob_offer(
    endpoint: &Endpoint,
    blobs: &BlobStore,
    audio_path: &Path,
    audio_rel: String,
    sha256: String,
    byte_length: u64,
) -> Result<(AudioUploadHeader, TempTag), String> {
    let absolute = std::path::absolute(audio_path)
        .map_err(|error| format!("Could not resolve the recording path: {error}"))?;
    let added = blobs
        .blobs()
        .add_path(absolute)
        .temp_tag()
        .await
        .map_err(|error| format!("Could not hash the recording with iroh-blobs: {error}"))?;
    if added.format() != BlobFormat::Raw {
        return Err("The recording was imported as an unexpected blob collection.".to_string());
    }
    // A relay makes the phone dialable from anywhere. Not having one yet is not
    // fatal: the ticket still carries the phone's endpoint id, and the computer
    // resolves that through address lookup.
    if tokio::time::timeout(IROH_BLOB_PUBLISH_TIMEOUT, endpoint.online())
        .await
        .is_err()
    {
        eprintln!("[iroh-sync] offering a recording before a relay attached; the computer will resolve this phone by id");
    }
    let ticket = BlobTicket::new(endpoint.addr(), added.hash(), added.format());
    let header = AudioUploadHeader {
        audio_path: audio_rel,
        sha256,
        blake3: added.hash().to_string(),
        byte_length,
        blob_ticket: ticket.to_string(),
    };
    Ok((header, added))
}

async fn send_audio_blob_offer(
    dialer: &IrohDialer,
    header: &AudioUploadHeader,
) -> Result<(), String> {
    let (mut send, mut recv) = open_desktop_stream(dialer, IROH_AUDIO_HANDSHAKE).await?;
    let header_json = serde_json::to_vec(header)
        .map_err(|error| format!("Failed to encode the audio archive request: {error}"))?;
    let header_len = u32::try_from(header_json.len())
        .map_err(|_| "The audio archive header is too large.".to_string())?;
    send.write_u32(header_len)
        .await
        .map_err(|error| format!("Could not send the audio archive header: {error}"))?;
    send.write_all(&header_json)
        .await
        .map_err(|error| format!("Could not send the audio archive header: {error}"))?;
    send.finish()
        .map_err(|error| format!("Could not finish the audio blob offer: {error}"))?;

    let response_len = recv
        .read_u32()
        .await
        .map_err(|error| format!("Desktop did not acknowledge the audio archive: {error}"))?
        as usize;
    if response_len > MAX_AUDIO_HEADER_BYTES {
        return Err("The desktop returned an invalid audio acknowledgement.".to_string());
    }
    let mut response_json = vec![0u8; response_len];
    recv.read_exact(&mut response_json)
        .await
        .map_err(|error| format!("Could not read the desktop audio acknowledgement: {error}"))?;
    let response: AudioUploadResponse = serde_json::from_slice(&response_json)
        .map_err(|error| format!("The desktop audio acknowledgement is invalid: {error}"))?;
    if !response.ok {
        return Err(response
            .error
            .unwrap_or_else(|| "The desktop rejected the audio archive.".to_string()));
    }
    if response.sha256.as_deref() != Some(header.sha256.as_str())
        || response.blake3.as_deref() != Some(header.blake3.as_str())
        || response.byte_length != Some(header.byte_length)
    {
        return Err("The desktop acknowledged different audio bytes.".to_string());
    }
    Ok(())
}

async fn forward_bidi(
    tcp: tokio::net::TcpStream,
    mut iroh_send: SendStream,
    mut iroh_recv: RecvStream,
) -> Result<(), String> {
    let (mut tcp_read, mut tcp_write) = tcp.into_split();
    let upload = async {
        tokio::io::copy(&mut tcp_read, &mut iroh_send)
            .await
            .map_err(|error| format!("Tunnel upload failed: {error}"))?;
        iroh_send
            .finish()
            .map_err(|error| format!("Tunnel upload close failed: {error}"))?;
        Ok::<(), String>(())
    };
    let download = async {
        tokio::io::copy(&mut iroh_recv, &mut tcp_write)
            .await
            .map_err(|error| format!("Tunnel download failed: {error}"))?;
        tcp_write
            .shutdown()
            .await
            .map_err(|error| format!("Tunnel download close failed: {error}"))?;
        Ok::<(), String>(())
    };
    tokio::try_join!(upload, download)?;
    Ok(())
}

// ── Shared helpers ───────────────────────────────────────────────────────────

fn runtime(label: &str) -> Result<tokio::runtime::Runtime, String> {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|error| format!("Failed to start the {label} runtime: {error}"))
}

fn short_endpoint_id(id: &EndpointId) -> String {
    id.to_string().chars().take(8).collect()
}

fn secret_path(app: &AppEnv, file_name: &str) -> Result<PathBuf, String> {
    let folder = app_data_dir(app)?.join("iroh");
    fs::create_dir_all(&folder)
        .map_err(|error| format!("Failed to create the Iroh data folder: {error}"))?;
    Ok(folder.join(file_name))
}

fn blob_store_path(app: &AppEnv, folder_name: &str) -> Result<PathBuf, String> {
    let folder = app_data_dir(app)?.join("iroh").join(folder_name);
    fs::create_dir_all(&folder)
        .map_err(|error| format!("Failed to create the Iroh blob folder: {error}"))?;
    Ok(folder)
}

fn iroh_endpoints_path(app: &AppEnv) -> Result<PathBuf, String> {
    let folder = app_data_dir(app)?.join("local_sync");
    fs::create_dir_all(&folder)
        .map_err(|error| format!("Failed to create the direct-sync data folder: {error}"))?;
    Ok(folder.join(IROH_ENDPOINTS_FILE))
}

fn load_authorized_iroh_endpoints(path: &Path) -> Vec<String> {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

fn register_authorized_iroh_endpoint(path: &Path, endpoint_id: &str) -> Result<(), String> {
    let mut endpoints = load_authorized_iroh_endpoints(path);
    if endpoints.iter().any(|allowed| allowed == endpoint_id) {
        return Ok(());
    }
    endpoints.push(endpoint_id.to_string());
    let content = serde_json::to_vec_pretty(&endpoints)
        .map_err(|error| format!("Could not encode the Iroh paired-device store: {error}"))?;
    write_private_key(path, &content)
        .map_err(|error| format!("Could not save the Iroh paired-device store: {error}"))
}

fn load_or_create_secret(app: &AppEnv, file_name: &str) -> Result<SecretKey, String> {
    let path = secret_path(app, file_name)?;
    if path.exists() {
        let bytes = fs::read(&path)
            .map_err(|error| format!("Failed to read the Iroh identity: {error}"))?;
        let bytes: [u8; 32] = bytes
            .try_into()
            .map_err(|_| "The stored Iroh identity has an invalid length.".to_string())?;
        return Ok(SecretKey::from_bytes(&bytes));
    }

    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    write_private_key(&path, &bytes)?;
    Ok(SecretKey::from_bytes(&bytes))
}

fn write_private_key(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::write(path, bytes)
        .map_err(|error| format!("Failed to store the Iroh identity: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Failed to protect the Iroh identity: {error}"))?;
    }
    Ok(())
}

fn rewrite_ssh_remote_to_loopback(remote_url: &str, port: u16) -> Result<String, String> {
    let remote = remote_url.trim();
    let rest = remote
        .strip_prefix("ssh://")
        .or_else(|| remote.strip_prefix("SSH://"))
        .ok_or_else(|| "Iroh sync currently supports ssh:// remotes only.".to_string())?;
    let (authority, path) = rest
        .split_once('/')
        .ok_or_else(|| "The SSH sync remote is missing its repository path.".to_string())?;
    if path.is_empty() {
        return Err("The SSH sync remote is missing its repository path.".to_string());
    }
    let user = authority
        .rsplit_once('@')
        .map(|(user, _)| format!("{user}@"))
        .unwrap_or_default();
    Ok(format!("ssh://{user}127.0.0.1:{port}/{path}"))
}

fn pairing_token_from_ssh_remote(remote_url: &str) -> Option<String> {
    let remote = remote_url.trim();
    let rest = remote
        .strip_prefix("ssh://")
        .or_else(|| remote.strip_prefix("SSH://"))?;
    let (userinfo, _) = rest.split_once('@')?;
    let token = userinfo.strip_prefix("pair-")?;
    (!token.is_empty() && token.chars().all(|char| char.is_ascii_hexdigit()))
        .then(|| token.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_auth(folder: &Path, current_token: &str) -> IrohServerAuth {
        IrohServerAuth {
            pairing_token: Arc::new(Mutex::new(current_token.to_string())),
            consumed_pairing_tokens: Arc::new(Mutex::new(Vec::new())),
            endpoints_path: folder.join(IROH_ENDPOINTS_FILE),
            endpoints_lock: Arc::new(Mutex::new(())),
        }
    }

    fn temp_folder(label: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("type-iroh-{label}-{}", Uuid::now_v7()));
        fs::create_dir_all(&folder).unwrap();
        folder
    }

    /// A relay-less, discovery-less endpoint on loopback, so the wire tests run
    /// entirely in-process and never touch the network.
    async fn localhost_endpoint() -> Endpoint {
        Endpoint::builder(presets::Minimal)
            .clear_ip_transports()
            .bind_addr((std::net::Ipv4Addr::LOCALHOST, 0))
            .expect("loopback bind address")
            .bind()
            .await
            .expect("bind loopback endpoint")
    }

    struct TestDesktop {
        router: Router,
        addr: EndpointAddr,
    }

    async fn spawn_test_desktop(
        folder: &Path,
        auth: IrohServerAuth,
        target_port: u16,
    ) -> TestDesktop {
        let endpoint = localhost_endpoint().await;
        let blobs_path = folder.join("server-blobs");
        fs::create_dir_all(&blobs_path).unwrap();
        let store: BlobStore = FsStore::load(blobs_path).await.unwrap().into();
        let blobs = BlobsProtocol::new(&store, None);
        let protocol = TypeSyncProtocol {
            target_port,
            repo_root: folder.to_path_buf(),
            endpoint: endpoint.clone(),
            blobs: store,
            auth,
        };
        let router = Router::builder(endpoint)
            .accept(IROH_ALPN, protocol)
            .accept(iroh_blobs::ALPN, blobs)
            .spawn();
        let addr = router.endpoint().addr();
        TestDesktop { router, addr }
    }

    async fn test_dialer(addr: EndpointAddr) -> IrohDialer {
        IrohDialer {
            endpoint: localhost_endpoint().await,
            remote: Arc::new(Mutex::new(RemoteTarget { id: addr.id, addr })),
            connection: Arc::new(tokio::sync::Mutex::new(None)),
            diagnostics: Arc::new(Mutex::new(ClientDiagnostics::default())),
        }
    }

    #[test]
    fn rewrites_ssh_remote_and_preserves_pairing_user_and_path() {
        assert_eq!(
            rewrite_ssh_remote_to_loopback("ssh://pair-secret@192.168.1.2:9418/My%20Notes", 19_418)
                .unwrap(),
            "ssh://pair-secret@127.0.0.1:19418/My%20Notes"
        );
    }

    #[test]
    fn rejects_non_ssh_remotes() {
        assert!(rewrite_ssh_remote_to_loopback("https://example.test/repo", 19_418).is_err());
    }

    #[test]
    fn extracts_only_hex_pairing_tokens_from_ssh_urls() {
        assert_eq!(
            pairing_token_from_ssh_remote("ssh://pair-deadbeef@example.test/Notes").as_deref(),
            Some("deadbeef")
        );
        assert!(pairing_token_from_ssh_remote("ssh://example.test/Notes").is_none());
        assert!(pairing_token_from_ssh_remote("ssh://pair-not-hex@example.test/Notes").is_none());
    }

    #[test]
    fn pairing_token_registers_an_iroh_endpoint_once() {
        let folder = temp_folder("auth");
        let auth = test_auth(&folder, "deadbeef");
        assert!(!auth.is_authorized("phone-endpoint"));
        assert!(auth
            .authorize_with_pairing_token("phone-endpoint", "bad0cafe")
            .is_err());
        auth.authorize_with_pairing_token("phone-endpoint", "deadbeef")
            .unwrap();
        assert!(auth.is_authorized("phone-endpoint"));
        assert_eq!(
            load_authorized_iroh_endpoints(&auth.endpoints_path),
            vec!["phone-endpoint"]
        );
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn empty_token_only_confirms_an_endpoint_that_is_already_paired() {
        let folder = temp_folder("check");
        let auth = test_auth(&folder, "deadbeef");
        // The phone asks on every sync so its Sync screen can report audio
        // pairing. Before pairing that must be a "no", never an accidental yes.
        assert!(auth
            .authorize_with_pairing_token("phone-endpoint", "")
            .is_err());
        auth.authorize_with_pairing_token("phone-endpoint", "deadbeef")
            .unwrap();
        assert!(auth
            .authorize_with_pairing_token("phone-endpoint", "")
            .is_ok());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn a_token_the_ssh_server_just_rotated_away_still_pairs_iroh() {
        // One QR scan pairs SSH and Iroh. SSH lands first and rotates the
        // token, so without the shared grace list the Iroh half of the same
        // scan would be rejected.
        let folder = temp_folder("rotated");
        let auth = test_auth(&folder, "f00dbabe");
        auth.consumed_pairing_tokens
            .lock()
            .unwrap()
            .push(("deadbeef".to_string(), Instant::now() + Duration::from_secs(300)));
        auth.authorize_with_pairing_token("phone-endpoint", "deadbeef")
            .unwrap();
        assert!(auth.is_authorized("phone-endpoint"));
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn an_expired_consumed_token_no_longer_pairs() {
        let folder = temp_folder("expired");
        let auth = test_auth(&folder, "f00dbabe");
        auth.consumed_pairing_tokens
            .lock()
            .unwrap()
            .push(("deadbeef".to_string(), Instant::now() - Duration::from_secs(1)));
        assert!(auth
            .authorize_with_pairing_token("phone-endpoint", "deadbeef")
            .is_err());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn a_ticket_yields_both_a_dialable_address_and_a_bare_identity() {
        // The identity is what survives the computer changing networks: the
        // address set in the ticket goes stale, the id never does.
        let computer = SecretKey::from_bytes(&[7u8; 32]).public();
        let relay = "https://relay.example.test./".parse().unwrap();
        let ticket = EndpointTicket::new(EndpointAddr::new(computer).with_relay_url(relay))
            .to_string();
        let target = remote_target_from_args(&StartIrohClientArgs {
            ticket,
            remote_url: "ssh://pair-deadbeef@192.168.1.2:9418/Notes".to_string(),
        })
        .unwrap();
        assert_eq!(target.id, computer);
        assert!(!target.addr.is_empty());
    }

    /// The regression test for "the desktop did not acknowledge Iroh pairing:
    /// connection lost". The desktop used to reply and return, and iroh's
    /// router closes the connection as soon as a handler returns — discarding
    /// the reply QUIC had not yet had acknowledged.
    ///
    /// Delivery of a single reply cannot be tested over loopback: with no loss
    /// and no latency the racing close nearly always loses. What *is*
    /// deterministic is the invariant behind the fix — the desktop stays in its
    /// accept loop, so the same connection serves a second stream. Under the
    /// old handler the connection was gone after the first.
    #[tokio::test]
    async fn the_desktop_keeps_a_connection_open_across_streams() {
        let folder = temp_folder("pair-wire");
        let auth = test_auth(&folder, "deadbeef");
        let desktop = spawn_test_desktop(&folder, auth.clone(), 0).await;
        let dialer = test_dialer(desktop.addr.clone()).await;
        let phone = dialer.endpoint.id().to_string();

        // The QR token authorizes this phone…
        check_iroh_pairing(&dialer, "deadbeef").await.unwrap();
        assert!(auth.is_authorized(&phone));
        let first = dialer.connection().await.unwrap().stable_id();

        // …and the token-less check it runs on every later sync is answered on
        // that same connection rather than on a fresh dial.
        check_iroh_pairing(&dialer, "").await.unwrap();
        let connection = dialer.connection().await.unwrap();
        assert_eq!(
            connection.stable_id(),
            first,
            "the second pairing check redialled, so the desktop had closed the connection"
        );
        assert!(connection.close_reason().is_none());

        let _ = desktop.router.shutdown().await;
        fs::remove_dir_all(folder).ok();
    }

    /// A phone that is not paired must be told so, rather than left waiting on
    /// a reply that never arrives.
    #[tokio::test]
    async fn an_unpaired_phone_gets_a_clear_no() {
        let folder = temp_folder("pair-refused");
        let auth = test_auth(&folder, "deadbeef");
        let desktop = spawn_test_desktop(&folder, auth, 0).await;
        let dialer = test_dialer(desktop.addr.clone()).await;

        let error = check_iroh_pairing(&dialer, "bad0cafe").await.unwrap_err();
        assert!(error.contains("has not paired this phone"), "{error}");

        let _ = desktop.router.shutdown().await;
        fs::remove_dir_all(folder).ok();
    }

    /// A git fetch response is far bigger than one packet. The desktop used to
    /// return the moment its copy finished, so the tail of the response could
    /// be discarded with the connection — a truncated, corrupt-looking sync.
    #[tokio::test]
    async fn a_full_response_survives_the_tunnel() {
        let folder = temp_folder("tunnel");
        // Stand in for the embedded SSH server: echo whatever arrives.
        let echo = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let echo_port = echo.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = echo.accept().await {
                tokio::spawn(async move {
                    let (mut read, mut write) = stream.split();
                    let _ = tokio::io::copy(&mut read, &mut write).await;
                    let _ = write.shutdown().await;
                });
            }
        });

        let auth = test_auth(&folder, "deadbeef");
        let desktop = spawn_test_desktop(&folder, auth, echo_port).await;
        let dialer = test_dialer(desktop.addr.clone()).await;

        let payload: Vec<u8> = (0..1_048_576u32).map(|index| index as u8).collect();
        let (mut send, mut recv) = open_desktop_stream(&dialer, IROH_SSH_HANDSHAKE)
            .await
            .unwrap();
        // Read while writing: a megabyte does not fit in one flow-control
        // window, so a write-then-read test would deadlock on its own.
        let sent = payload.clone();
        let writer = tokio::spawn(async move {
            send.write_all(&sent).await.unwrap();
            send.finish().unwrap();
        });
        let mut received = Vec::new();
        tokio::io::AsyncReadExt::read_to_end(&mut recv, &mut received)
            .await
            .unwrap();
        writer.await.unwrap();

        assert_eq!(
            received.len(),
            payload.len(),
            "the tunnel truncated the response"
        );
        assert_eq!(received, payload);
        // A finished git operation must leave the connection usable: libgit2
        // opens a second connection for the push half of a sync, and paying a
        // fresh QUIC handshake for it is what made syncs feel unreliable.
        assert!(
            dialer.connection().await.unwrap().close_reason().is_none(),
            "the desktop closed the connection once its first stream finished"
        );

        let _ = desktop.router.shutdown().await;
        fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn an_unparseable_ticket_is_refused_before_any_dialling() {
        assert!(remote_target_from_args(&StartIrohClientArgs {
            ticket: "  ".to_string(),
            remote_url: "ssh://pair-deadbeef@192.168.1.2:9418/Notes".to_string(),
        })
        .is_err());
    }
}
