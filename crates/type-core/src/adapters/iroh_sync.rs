//! SSH-over-Iroh transport used by the direct-sync experiment.
//!
//! Git and SSH remain completely unaware of Iroh. The desktop accepts Iroh
//! streams and forwards them to the embedded SSH server on loopback. The phone
//! exposes a loopback TCP listener and forwards each libgit2 SSH connection to
//! the desktop's Iroh endpoint.

use crate::{app_data_dir, AppEnv};
use iroh::{Endpoint, SecretKey};
use iroh_base::ticket::NodeTicket;
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    str::FromStr,
    sync::Mutex,
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

const IROH_ALPN: &[u8] = b"type/ssh-tunnel/1";
const IROH_SSH_HANDSHAKE: &[u8; 5] = b"type1";
const IROH_AUDIO_HANDSHAKE: &[u8; 5] = b"aud01";
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
    byte_length: u64,
}

#[derive(Deserialize, Serialize)]
struct AudioUploadResponse {
    ok: bool,
    error: Option<String>,
    sha256: Option<String>,
    byte_length: Option<u64>,
}

/// Desktop-side endpoint owned by the embedded local-sync daemon.
pub struct IrohServerHandle {
    runtime: tokio::runtime::Runtime,
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
        self.runtime.shutdown_background();
    }
}

struct IrohClientHandle {
    runtime: tokio::runtime::Runtime,
    endpoint: Endpoint,
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
        self.runtime.shutdown_background();
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
    let runtime = runtime("Iroh sync server")?;
    let endpoint = runtime.block_on(async {
        Endpoint::builder()
            .secret_key(secret)
            .alpns(vec![IROH_ALPN.to_vec()])
            .bind()
            .await
            .map_err(|error| format!("Failed to bind the Iroh sync endpoint: {error}"))
    })?;

    // A relay address makes the QR useful across networks. Offline startup is
    // still allowed: the ticket can retain direct addresses for LAN testing.
    let node_addr = runtime
        .block_on(tokio::time::timeout(
            IROH_ONLINE_TIMEOUT,
            endpoint.node_addr(),
        ))
        .map_err(|_| "Iroh did not discover a relay or direct address in time.".to_string())?
        .map_err(|error| format!("Failed to resolve the Iroh endpoint address: {error}"))?;
    let ticket = NodeTicket::new(node_addr).to_string();
    let endpoint_id = endpoint.node_id().to_string();
    let accept_endpoint = endpoint.clone();
    runtime.spawn(async move {
        while let Some(incoming) = accept_endpoint.accept().await {
            let accepting = match incoming.accept() {
                Ok(accepting) => accepting,
                Err(error) => {
                    eprintln!("[iroh-sync] rejected incoming connection: {error}");
                    continue;
                }
            };
            let repo_root = repo_root.clone();
            tokio::spawn(async move {
                if let Err(error) = handle_iroh_connection(accepting, target_port, repo_root).await {
                    eprintln!("[iroh-sync] desktop tunnel failed: {error}");
                }
            });
        }
    });

    eprintln!("[iroh-sync] desktop endpoint ready: {endpoint_id}");
    Ok(IrohServerHandle {
        runtime,
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
    let runtime = runtime("Iroh sync client")?;
    let endpoint = runtime.block_on(async {
        Endpoint::builder()
            .secret_key(secret)
            .bind()
            .await
            .map_err(|error| format!("Failed to bind the Iroh client endpoint: {error}"))
    })?;
    let listener = runtime
        .block_on(tokio::net::TcpListener::bind((
            "127.0.0.1",
            IROH_CLIENT_PROXY_PORT,
        )))
        .map_err(|error| {
            format!(
                "Failed to start the phone sync proxy on port {IROH_CLIENT_PROXY_PORT}: {error}"
            )
        })?;

    let endpoint_id = parsed.node_addr().node_id.to_string();
    let remote_addr = parsed.node_addr().clone();
    let proxy_remote_addr = remote_addr.clone();
    let accept_endpoint = endpoint.clone();
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
        endpoint,
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

/// Upload every local audio attachment that does not yet have an exact
/// desktop acknowledgement. Audio uses a separate Iroh stream and never
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
        if crate::audio_has_desktop_ack(
            &root,
            &recording.audio_rel,
            &sha256,
            byte_length,
        ) {
            result.already_archived += 1;
            continue;
        }
        let header = AudioUploadHeader {
            audio_path: recording.audio_rel.clone(),
            sha256: sha256.clone(),
            byte_length,
        };
        client.runtime.block_on(upload_audio_file(
            &client.endpoint,
            client.remote_addr.clone(),
            &recording.audio_path,
            &header,
        ))?;
        crate::record_desktop_audio_ack(
            &root,
            recording.audio_rel,
            sha256,
            byte_length,
        )?;
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
    accepting: iroh::endpoint::Connecting,
    target_port: u16,
    repo_root: PathBuf,
) -> Result<(), String> {
    let connection = accepting
        .await
        .map_err(|error| format!("Iroh connection failed: {error}"))?;
    let (send, mut recv) = connection
        .accept_bi()
        .await
        .map_err(|error| format!("Iroh stream failed: {error}"))?;
    let mut handshake = [0u8; IROH_SSH_HANDSHAKE.len()];
    recv.read_exact(&mut handshake)
        .await
        .map_err(|error| format!("Iroh handshake failed: {error}"))?;
    if &handshake == IROH_AUDIO_HANDSHAKE {
        return receive_audio_file(send, recv, repo_root).await;
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

async fn upload_audio_file(
    endpoint: &Endpoint,
    remote_addr: iroh::NodeAddr,
    audio_path: &Path,
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
    let mut file = tokio::fs::File::open(audio_path)
        .await
        .map_err(|error| format!("Failed to open audio '{}': {error}", audio_path.display()))?;
    let copied = tokio::io::copy(&mut file, &mut send)
        .await
        .map_err(|error| format!("Audio archive upload failed: {error}"))?;
    if copied != header.byte_length {
        return Err(format!(
            "Audio changed while it was uploading (expected {} bytes, sent {copied}).",
            header.byte_length
        ));
    }
    send.finish()
        .map_err(|error| format!("Could not finish the audio archive upload: {error}"))?;

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
        || response.byte_length != Some(header.byte_length)
    {
        return Err("The desktop acknowledged different audio bytes.".to_string());
    }
    Ok(())
}

async fn receive_audio_file(
    mut send: iroh::endpoint::SendStream,
    mut recv: iroh::endpoint::RecvStream,
    repo_root: PathBuf,
) -> Result<(), String> {
    let result = receive_audio_file_inner(&mut recv, &repo_root).await;
    let response = match &result {
        Ok((sha256, byte_length)) => AudioUploadResponse {
            ok: true,
            error: None,
            sha256: Some(sha256.clone()),
            byte_length: Some(*byte_length),
        },
        Err(error) => AudioUploadResponse {
            ok: false,
            error: Some(error.clone()),
            sha256: None,
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

async fn receive_audio_file_inner(
    recv: &mut iroh::endpoint::RecvStream,
    repo_root: &Path,
) -> Result<(String, u64), String> {
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
    let mut output = tokio::fs::File::create(&temporary)
        .await
        .map_err(|error| format!("Could not create the desktop audio archive: {error}"))?;
    let mut limited = recv.take(header.byte_length);
    let copied = match tokio::io::copy(&mut limited, &mut output).await {
        Ok(copied) => copied,
        Err(error) => {
            drop(output);
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(format!("Could not receive the audio archive: {error}"));
        }
    };
    if let Err(error) = output.sync_all().await {
        drop(output);
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(format!("Could not flush the desktop audio archive: {error}"));
    }
    drop(output);
    if copied != header.byte_length {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(format!(
            "The audio archive ended early (expected {} bytes, received {copied}).",
            header.byte_length
        ));
    }
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
    if target.exists() {
        let existing_path = target.clone();
        let existing = tokio::task::spawn_blocking(move || crate::hash_file(&existing_path)).await;
        let _ = tokio::fs::remove_file(&temporary).await;
        let existing = existing
            .map_err(|error| format!("Desktop audio verification worker failed: {error}"))??;
        if existing != (sha256.clone(), byte_length) {
            return Err("The desktop already has different audio at this path.".to_string());
        }
        return Ok((sha256, byte_length));
    }
    if let Err(error) = tokio::fs::rename(&temporary, &target).await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(format!("Could not finalize the desktop audio archive: {error}"));
    }
    Ok((sha256, byte_length))
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
