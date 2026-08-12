//! SSH-over-Iroh transport plus content-addressed recording transfer.
//!
//! Git and SSH remain completely unaware of Iroh. The desktop accepts Iroh
//! streams and forwards them to the embedded SSH server on loopback. The phone
//! exposes a loopback TCP listener and forwards each libgit2 SSH connection to
//! the desktop's Iroh endpoint. Recording bytes are provided by `iroh-blobs`;
//! the custom Type stream carries only a small path/hash offer and receipt.

use crate::{app_data_dir, AppEnv};
use iroh::{
    endpoint::Connection,
    protocol::{ProtocolHandler, Router},
    Endpoint, SecretKey,
};
use iroh_base::ticket::NodeTicket;
use iroh_blobs::{
    net_protocol::Blobs,
    rpc::client::blobs::{MemClient as BlobsClient, WrapOption},
    store::{ExportFormat, ExportMode},
    ticket::BlobTicket,
    util::SetTagOption,
    BlobFormat,
};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    str::FromStr,
    sync::Mutex,
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

const IROH_ALPN: &[u8] = b"type/ssh-tunnel/1";
const IROH_SSH_HANDSHAKE: &[u8; 5] = b"type1";
const IROH_AUDIO_HANDSHAKE: &[u8; 5] = b"aud02";
const IROH_ONLINE_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_AUDIO_HEADER_BYTES: usize = 16 * 1024;
const MAX_AUDIO_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const IROH_CLIENT_PROXY_PORT: u16 = 19_418;

/// Arguments supplied by the mobile shell after scanning a pairing QR.
#[derive(Clone, Deserialize)]
pub struct StartIrohClientArgs {
    pub ticket: String,
    pub remote_url: String,
}

/// Loopback connection details returned to the mobile Git adapter.
#[derive(Clone, Serialize)]
pub struct IrohClientStatus {
    pub running: bool,
    pub local_port: u16,
    pub local_remote_url: String,
    pub endpoint_id: String,
}

#[derive(Clone, Serialize)]
pub struct IrohAudioArchiveResult {
    pub scanned: usize,
    pub uploaded: usize,
    pub already_archived: usize,
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

/// Desktop-side endpoint owned by the embedded local-sync daemon.
pub struct IrohServerHandle {
    runtime: tokio::runtime::Runtime,
    router: Router,
    ticket: String,
    endpoint_id: String,
}

impl IrohServerHandle {
    pub fn ticket(&self) -> &str {
        &self.ticket
    }

    pub fn endpoint_id(&self) -> &str {
        &self.endpoint_id
    }

    pub fn stop(self) {
        let Self {
            runtime, router, ..
        } = self;
        let _ = runtime.block_on(router.shutdown());
        runtime.shutdown_background();
    }
}

struct IrohClientHandle {
    runtime: tokio::runtime::Runtime,
    router: Router,
    blobs: BlobsClient,
    remote_addr: iroh::NodeAddr,
    ticket: String,
    endpoint_id: String,
    local_port: u16,
}

impl IrohClientHandle {
    fn status_for_remote(&self, remote_url: &str) -> Result<IrohClientStatus, String> {
        Ok(IrohClientStatus {
            running: true,
            local_port: self.local_port,
            local_remote_url: rewrite_ssh_remote_to_loopback(remote_url, self.local_port)?,
            endpoint_id: self.endpoint_id.clone(),
        })
    }

    fn stop(self) {
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
    blobs: BlobsClient,
}

impl ProtocolHandler for TypeSyncProtocol {
    fn accept(
        &self,
        connection: Connection,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send + 'static>> {
        let this = self.clone();
        Box::pin(async move {
            handle_iroh_connection(connection, this.target_port, this.repo_root, this.blobs)
                .await
                .map_err(anyhow::Error::msg)
        })
    }
}

static CLIENT: Mutex<Option<IrohClientHandle>> = Mutex::new(None);

/// Start the desktop endpoint and forward accepted streams to the SSH server.
pub fn start_iroh_sync_server(
    app: &AppEnv,
    target_port: u16,
    repo_root: PathBuf,
) -> Result<IrohServerHandle, String> {
    let secret = load_or_create_secret(app, "server.key")?;
    let blobs_path = blob_store_path(app, "server-blobs")?;
    let runtime = runtime("Iroh sync server")?;
    let router = runtime.block_on(async {
        let endpoint = Endpoint::builder()
            .secret_key(secret)
            .bind()
            .await
            .map_err(|error| format!("Failed to bind the Iroh sync endpoint: {error}"))?;
        let blobs = Blobs::persistent(blobs_path)
            .await
            .map_err(|error| format!("Failed to open the desktop Iroh blob store: {error}"))?
            .build(&endpoint);
        let sync = TypeSyncProtocol {
            target_port,
            repo_root,
            blobs: blobs.client().clone(),
        };
        Ok::<Router, String>(
            Router::builder(endpoint)
                .accept(IROH_ALPN, sync)
                .accept(iroh_blobs::ALPN, blobs)
                .spawn(),
        )
    })?;

    // A relay address makes the QR useful across networks. Offline startup is
    // still allowed: the ticket can retain direct addresses for LAN testing.
    let node_addr = runtime
        .block_on(tokio::time::timeout(
            IROH_ONLINE_TIMEOUT,
            router.endpoint().node_addr(),
        ))
        .map_err(|_| "Iroh did not discover a relay or direct address in time.".to_string())?
        .map_err(|error| format!("Failed to resolve the Iroh endpoint address: {error}"))?;
    let ticket = NodeTicket::new(node_addr).to_string();
    let endpoint_id = router.endpoint().node_id().to_string();

    eprintln!("[iroh-sync] desktop endpoint ready: {endpoint_id}");
    Ok(IrohServerHandle {
        runtime,
        router,
        ticket,
        endpoint_id,
    })
}

/// Start (or reuse) the phone's loopback proxy for an Iroh endpoint ticket.
pub fn start_iroh_sync_client(
    app: &AppEnv,
    args: StartIrohClientArgs,
) -> Result<IrohClientStatus, String> {
    let ticket = args.ticket.trim();
    if ticket.is_empty() {
        return Err("The Iroh endpoint ticket is empty.".to_string());
    }
    let parsed = NodeTicket::from_str(ticket)
        .map_err(|error| format!("The Iroh endpoint ticket is invalid: {error}"))?;

    let mut guard = CLIENT
        .lock()
        .map_err(|_| "Iroh client state is poisoned.".to_string())?;
    if let Some(client) = guard.as_ref() {
        if client.ticket == ticket {
            return client.status_for_remote(&args.remote_url);
        }
    }
    if let Some(previous) = guard.take() {
        previous.stop();
    }

    let secret = load_or_create_secret(app, "client.key")?;
    let blobs_path = blob_store_path(app, "client-blobs")?;
    let runtime = runtime("Iroh sync client")?;
    let (router, blobs, listener) = runtime.block_on(async {
        let endpoint = Endpoint::builder()
            .secret_key(secret)
            .bind()
            .await
            .map_err(|error| format!("Failed to bind the Iroh client endpoint: {error}"))?;
        let blobs = Blobs::persistent(blobs_path)
            .await
            .map_err(|error| format!("Failed to open the phone Iroh blob store: {error}"))?
            .build(&endpoint);
        let blobs_client = blobs.client().clone();
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
        Ok::<_, String>((router, blobs_client, listener))
    })?;

    let endpoint_id = parsed.node_addr().node_id.to_string();
    let remote_addr = parsed.node_addr().clone();
    let proxy_remote_addr = remote_addr.clone();
    let accept_endpoint = router.endpoint().clone();
    runtime.spawn(async move {
        loop {
            let (tcp, peer) = match listener.accept().await {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("[iroh-sync] phone proxy stopped accepting connections: {error}");
                    break;
                }
            };
            let endpoint = accept_endpoint.clone();
            let remote_addr = proxy_remote_addr.clone();
            tokio::spawn(async move {
                if let Err(error) = forward_tcp_to_iroh(tcp, endpoint, remote_addr).await {
                    eprintln!("[iroh-sync] phone tunnel for {peer} failed: {error}");
                }
            });
        }
    });

    let client = IrohClientHandle {
        runtime,
        router,
        blobs,
        remote_addr,
        ticket: ticket.to_string(),
        endpoint_id,
        local_port: IROH_CLIENT_PROXY_PORT,
    };
    let status = client.status_for_remote(&args.remote_url)?;
    eprintln!(
        "[iroh-sync] phone proxy ready on 127.0.0.1:{} for endpoint {}",
        status.local_port, status.endpoint_id
    );
    *guard = Some(client);
    Ok(status)
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
    };
    let guard = CLIENT
        .lock()
        .map_err(|_| "Iroh client state is poisoned.".to_string())?;
    let client = guard
        .as_ref()
        .ok_or_else(|| "Start the Iroh sync connection before archiving audio.".to_string())?;

    for recording in recordings {
        if !recording.audio_path.is_file() {
            continue;
        }
        let (sha256, byte_length) = crate::hash_file(&recording.audio_path)?;
        if crate::audio_has_desktop_ack(&root, &recording.audio_rel, &sha256, byte_length) {
            result.already_archived += 1;
            continue;
        }
        let (header, blob_hash) = client.runtime.block_on(prepare_audio_blob_offer(
            client.router.endpoint(),
            &client.blobs,
            &recording.audio_path,
            recording.audio_rel.clone(),
            sha256.clone(),
            byte_length,
        ))?;
        client.runtime.block_on(send_audio_blob_offer(
            client.router.endpoint(),
            client.remote_addr.clone(),
            &header,
        ))?;
        if let Err(error) = client.runtime.block_on(client.blobs.delete_blob(blob_hash)) {
            eprintln!("[iroh-sync] could not release archived phone blob: {error}");
        }
        crate::record_desktop_audio_ack(&root, recording.audio_rel, sha256, byte_length)?;
        result.uploaded += 1;
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

async fn handle_iroh_connection(
    connection: Connection,
    target_port: u16,
    repo_root: PathBuf,
    blobs: BlobsClient,
) -> Result<(), String> {
    let (send, mut recv) = connection
        .accept_bi()
        .await
        .map_err(|error| format!("Iroh stream failed: {error}"))?;
    let mut handshake = [0u8; IROH_SSH_HANDSHAKE.len()];
    recv.read_exact(&mut handshake)
        .await
        .map_err(|error| format!("Iroh handshake failed: {error}"))?;
    if &handshake == IROH_AUDIO_HANDSHAKE {
        return receive_audio_blob_offer(send, recv, repo_root, blobs).await;
    }
    if &handshake != IROH_SSH_HANDSHAKE {
        return Err("Iroh handshake was not recognized.".to_string());
    }
    let tcp = tokio::net::TcpStream::connect(("127.0.0.1", target_port))
        .await
        .map_err(|error| format!("Could not reach the desktop SSH server: {error}"))?;
    forward_bidi(tcp, send, recv).await
}

async fn forward_tcp_to_iroh(
    tcp: tokio::net::TcpStream,
    endpoint: Endpoint,
    remote_addr: iroh::NodeAddr,
) -> Result<(), String> {
    let connection = endpoint
        .connect(remote_addr, IROH_ALPN)
        .await
        .map_err(|error| format!("Could not reach the desktop over Iroh: {error}"))?;
    let (mut send, recv) = connection
        .open_bi()
        .await
        .map_err(|error| format!("Could not open the Iroh sync stream: {error}"))?;
    // QUIC opens streams lazily; writing first makes the desktop's accept_bi
    // resolve even if libgit2 has not sent an SSH byte yet.
    send.write_all(IROH_SSH_HANDSHAKE)
        .await
        .map_err(|error| format!("Could not start the Iroh sync stream: {error}"))?;
    forward_bidi(tcp, send, recv).await
}

async fn prepare_audio_blob_offer(
    endpoint: &Endpoint,
    blobs: &BlobsClient,
    audio_path: &Path,
    audio_rel: String,
    sha256: String,
    byte_length: u64,
) -> Result<(AudioUploadHeader, iroh_blobs::Hash), String> {
    let absolute = std::path::absolute(audio_path)
        .map_err(|error| format!("Could not resolve the recording path: {error}"))?;
    let added = blobs
        .add_from_path(absolute, true, SetTagOption::Auto, WrapOption::NoWrap)
        .await
        .map_err(|error| format!("Could not add the recording to iroh-blobs: {error}"))?
        .finish()
        .await
        .map_err(|error| format!("Could not hash the recording with iroh-blobs: {error}"))?;
    if added.format != BlobFormat::Raw {
        return Err("The recording was imported as an unexpected blob collection.".to_string());
    }
    let node_addr = tokio::time::timeout(IROH_ONLINE_TIMEOUT, endpoint.node_addr())
        .await
        .map_err(|_| "The phone could not publish an Iroh blob address in time.".to_string())?
        .map_err(|error| format!("Could not publish the phone Iroh blob address: {error}"))?;
    let ticket = BlobTicket::new(node_addr, added.hash, added.format)
        .map_err(|error| format!("Could not create the recording blob ticket: {error}"))?;
    let header = AudioUploadHeader {
        audio_path: audio_rel,
        sha256,
        blake3: added.hash.to_string(),
        byte_length,
        blob_ticket: ticket.to_string(),
    };
    Ok((header, added.hash))
}

async fn send_audio_blob_offer(
    endpoint: &Endpoint,
    remote_addr: iroh::NodeAddr,
    header: &AudioUploadHeader,
) -> Result<(), String> {
    let connection = endpoint
        .connect(remote_addr, IROH_ALPN)
        .await
        .map_err(|error| format!("Could not reach the desktop for audio archive: {error}"))?;
    let (mut send, mut recv) = connection
        .open_bi()
        .await
        .map_err(|error| format!("Could not open the Iroh audio stream: {error}"))?;
    let header_json = serde_json::to_vec(header)
        .map_err(|error| format!("Failed to encode the audio archive request: {error}"))?;
    let header_len = u32::try_from(header_json.len())
        .map_err(|_| "The audio archive header is too large.".to_string())?;
    send.write_all(IROH_AUDIO_HANDSHAKE)
        .await
        .map_err(|error| format!("Could not start the Iroh audio stream: {error}"))?;
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

async fn receive_audio_blob_offer(
    mut send: iroh::endpoint::SendStream,
    mut recv: iroh::endpoint::RecvStream,
    repo_root: PathBuf,
    blobs: BlobsClient,
) -> Result<(), String> {
    let result = receive_audio_blob_inner(&mut recv, &repo_root, &blobs).await;
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
    recv: &mut iroh::endpoint::RecvStream,
    repo_root: &Path,
    blobs: &BlobsClient,
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
    blobs
        .download(ticket.hash(), ticket.node_addr().clone())
        .await
        .map_err(|error| format!("Could not start the recording blob download: {error}"))?
        .finish()
        .await
        .map_err(|error| format!("Could not download the recording blob: {error}"))?;
    blobs
        .export(
            ticket.hash(),
            temporary.clone(),
            ExportFormat::Blob,
            ExportMode::Copy,
        )
        .await
        .map_err(|error| format!("Could not start exporting the recording blob: {error}"))?
        .finish()
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
    let _ = blobs.delete_blob(ticket.hash()).await;
    Ok((sha256, header.blake3, byte_length))
}

async fn forward_bidi(
    tcp: tokio::net::TcpStream,
    mut iroh_send: iroh::endpoint::SendStream,
    mut iroh_recv: iroh::endpoint::RecvStream,
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

fn runtime(label: &str) -> Result<tokio::runtime::Runtime, String> {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|error| format!("Failed to start the {label} runtime: {error}"))
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
