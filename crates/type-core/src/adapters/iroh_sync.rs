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
use tokio::io::AsyncWriteExt;

const IROH_ALPN: &[u8] = b"type/ssh-tunnel/1";
const IROH_HANDSHAKE: &[u8; 5] = b"type1";
const IROH_ONLINE_TIMEOUT: Duration = Duration::from_secs(5);
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
pub fn start_iroh_sync_server(app: &AppEnv, target_port: u16) -> Result<IrohServerHandle, String> {
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
            tokio::spawn(async move {
                if let Err(error) = forward_iroh_to_tcp(accepting, target_port).await {
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
            let remote_addr = remote_addr.clone();
            tokio::spawn(async move {
                if let Err(error) = forward_tcp_to_iroh(tcp, endpoint, remote_addr).await {
                    eprintln!("[iroh-sync] phone tunnel for {peer} failed: {error}");
                }
            });
        }
    });

    let client = IrohClientHandle {
        runtime,
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

/// Stop the process-global phone proxy. Safe when no proxy is running.
pub fn shutdown_iroh_sync_client() {
    if let Ok(mut guard) = CLIENT.lock() {
        if let Some(client) = guard.take() {
            client.stop();
        }
    }
}

async fn forward_iroh_to_tcp(
    accepting: iroh::endpoint::Connecting,
    target_port: u16,
) -> Result<(), String> {
    let connection = accepting
        .await
        .map_err(|error| format!("Iroh connection failed: {error}"))?;
    let (send, mut recv) = connection
        .accept_bi()
        .await
        .map_err(|error| format!("Iroh stream failed: {error}"))?;
    let mut handshake = [0u8; IROH_HANDSHAKE.len()];
    recv.read_exact(&mut handshake)
        .await
        .map_err(|error| format!("Iroh handshake failed: {error}"))?;
    if &handshake != IROH_HANDSHAKE {
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
    send.write_all(IROH_HANDSHAKE)
        .await
        .map_err(|error| format!("Could not start the Iroh sync stream: {error}"))?;
    forward_bidi(tcp, send, recv).await
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
