//! Embedded SSH server that serves the notes repository over `git-upload-pack`
//! / `git-receive-pack`, so phones sync over an encrypted, key-authenticated
//! channel even on untrusted Wi-Fi.
//!
//! Authentication is public-key only, against the app's authorized-devices
//! store. Pairing rides on the SSH username: a client that offers an *unknown*
//! key but signs in as `pair-<token>` (the token is minted per server run and
//! embedded in the desktop's QR code) gets its key registered, then proceeds
//! like any paired device. Known keys are accepted under any username, so a
//! stale token in a saved remote URL keeps working.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use russh::keys::PublicKey;
use russh::server::{Auth, Config, Handler, Msg, Server, Session};
use russh::{Channel, ChannelId, CryptoVec};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, Command};

use super::devices;

/// State shared by every client connection of one server run.
pub(super) struct ServerShared {
    pub git_path: PathBuf,
    pub repo_path: PathBuf,
    pub served_name: String,
    pub pairing_token: String,
    pub devices_path: PathBuf,
}

pub(super) struct SshServerHandle {
    runtime: tokio::runtime::Runtime,
}

impl SshServerHandle {
    pub(super) fn stop(self) {
        // Aborts the accept loop and every in-flight session task.
        self.runtime.shutdown_background();
    }
}

/// Bind the port and run the SSH accept loop on a dedicated runtime. Returns
/// synchronously once the socket is bound so bind errors surface immediately.
pub(super) fn start_ssh_server(
    shared: Arc<ServerShared>,
    host_key_openssh: &str,
    port: u16,
) -> Result<SshServerHandle, String> {
    let host_key = russh::keys::PrivateKey::from_openssh(host_key_openssh)
        .map_err(|e| format!("Failed to load the sync server host key: {e}"))?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|e| format!("Failed to start the sync server runtime: {e}"))?;
    let listener = runtime
        .block_on(tokio::net::TcpListener::bind(("0.0.0.0", port)))
        .map_err(|e| {
            format!("Port {port} is unavailable ({e}). Stop the other program using it and try again.")
        })?;
    let config = Arc::new(Config {
        keys: vec![host_key],
        auth_rejection_time: std::time::Duration::from_millis(300),
        inactivity_timeout: Some(std::time::Duration::from_secs(600)),
        ..Default::default()
    });
    let mut server = GitSshServer { shared };
    runtime.spawn(async move {
        let _ = server.run_on_socket(config, &listener).await;
    });
    Ok(SshServerHandle { runtime })
}

struct GitSshServer {
    shared: Arc<ServerShared>,
}

impl Server for GitSshServer {
    type Handler = ClientHandler;

    fn new_client(&mut self, _peer: Option<std::net::SocketAddr>) -> ClientHandler {
        ClientHandler {
            shared: self.shared.clone(),
            stdins: HashMap::new(),
        }
    }
}

struct ClientHandler {
    shared: Arc<ServerShared>,
    /// Open stdin pipes of the git child process per exec channel.
    stdins: HashMap<ChannelId, ChildStdin>,
}

fn reject() -> Auth {
    Auth::Reject {
        proceed_with_methods: None,
        partial_success: false,
    }
}

impl Handler for ClientHandler {
    type Error = russh::Error;

    async fn auth_publickey(
        &mut self,
        user: &str,
        key: &PublicKey,
    ) -> Result<Auth, Self::Error> {
        let Some(key_line) = devices::public_key_line(key) else {
            return Ok(reject());
        };
        if devices::is_authorized(&self.shared.devices_path, &key_line) {
            return Ok(Auth::Accept);
        }
        let expected = format!("pair-{}", self.shared.pairing_token);
        if !self.shared.pairing_token.is_empty() && user == expected {
            let name = devices::device_name_from_key(key);
            if devices::register_device(&self.shared.devices_path, &key_line, &name).is_ok() {
                return Ok(Auth::Accept);
            }
        }
        Ok(reject())
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        let raw = String::from_utf8_lossy(data).to_string();
        let Some((service, requested_path)) = parse_git_command(&raw) else {
            session.channel_failure(channel)?;
            return Ok(());
        };
        if !path_matches(&requested_path, &self.shared.served_name, &self.shared.repo_path) {
            session.channel_success(channel)?;
            fail_channel(session, channel, "Repository not found on this computer.");
            return Ok(());
        }

        let spawned = Command::new(&self.shared.git_path)
            .arg(service)
            .arg(&self.shared.repo_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn();
        let mut child = match spawned {
            Ok(child) => child,
            Err(error) => {
                session.channel_success(channel)?;
                fail_channel(session, channel, &format!("Failed to run git: {error}"));
                return Ok(());
            }
        };

        session.channel_success(channel)?;
        if let Some(stdin) = child.stdin.take() {
            self.stdins.insert(channel, stdin);
        }
        pump_child_io(session, channel, child);
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if let Some(stdin) = self.stdins.get_mut(&channel) {
            if stdin.write_all(data).await.is_err() {
                self.stdins.remove(&channel);
            }
        }
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        // Dropping the pipe closes the child's stdin so git can finish.
        self.stdins.remove(&channel);
        Ok(())
    }

    async fn channel_close(
        &mut self,
        channel: ChannelId,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.stdins.remove(&channel);
        Ok(())
    }
}

/// Forward the git child's stdout/stderr to the SSH channel, then report its
/// exit status and close the channel.
fn pump_child_io(session: &mut Session, channel: ChannelId, mut child: Child) {
    let handle = session.handle();
    tokio::spawn(async move {
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let out_handle = handle.clone();
        let out_task = async move {
            let Some(mut stdout) = stdout else { return };
            let mut buf = vec![0u8; 32 * 1024];
            loop {
                match stdout.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if out_handle
                            .data(channel, CryptoVec::from_slice(&buf[..n]))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        };
        let err_handle = handle.clone();
        let err_task = async move {
            let Some(mut stderr) = stderr else { return };
            let mut buf = vec![0u8; 8 * 1024];
            loop {
                match stderr.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if err_handle
                            .extended_data(channel, 1, CryptoVec::from_slice(&buf[..n]))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        };
        tokio::join!(out_task, err_task);

        let code = child
            .wait()
            .await
            .ok()
            .and_then(|status| status.code())
            .unwrap_or(1) as u32;
        let _ = handle.exit_status_request(channel, code).await;
        let _ = handle.eof(channel).await;
        let _ = handle.close(channel).await;
    });
}

/// Send a git-visible error message and close the channel with exit status 128.
fn fail_channel(session: &mut Session, channel: ChannelId, message: &str) {
    let handle = session.handle();
    let message = format!("{message}\n");
    tokio::spawn(async move {
        let _ = handle
            .extended_data(channel, 1, CryptoVec::from_slice(message.as_bytes()))
            .await;
        let _ = handle.exit_status_request(channel, 128).await;
        let _ = handle.eof(channel).await;
        let _ = handle.close(channel).await;
    });
}

/// Parse a git exec command line: `git-upload-pack '/notes'` (also the spaced
/// `git upload-pack` spelling). Returns the git subcommand + the quoted path.
pub(super) fn parse_git_command(raw: &str) -> Option<(&'static str, String)> {
    let trimmed = raw.trim();
    let (service, rest) = if let Some(rest) = trimmed
        .strip_prefix("git-upload-pack")
        .or_else(|| trimmed.strip_prefix("git upload-pack"))
    {
        ("upload-pack", rest)
    } else if let Some(rest) = trimmed
        .strip_prefix("git-receive-pack")
        .or_else(|| trimmed.strip_prefix("git receive-pack"))
    {
        ("receive-pack", rest)
    } else {
        return None;
    };
    let path = rest.trim().trim_matches('\'').trim_matches('"').to_string();
    if path.is_empty() {
        return None;
    }
    Some((service, path))
}

/// Minimal %XX decoding for URL paths (folder names with spaces etc.).
pub(super) fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &value[i + 1..i + 3];
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Does the path a client asked for refer to the served notes repository?
pub(super) fn path_matches(requested: &str, served_name: &str, repo_path: &std::path::Path) -> bool {
    let stripped = requested.trim_start_matches('/').trim_end_matches('/');
    let decoded = percent_decode(stripped);
    if stripped == served_name || decoded == served_name {
        return true;
    }
    let full = percent_decode(requested.trim_end_matches('/'));
    full == repo_path.to_string_lossy()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_upload_and_receive_pack_commands() {
        assert_eq!(
            parse_git_command("git-upload-pack '/notes'"),
            Some(("upload-pack", "/notes".to_string()))
        );
        assert_eq!(
            parse_git_command("git receive-pack \"/My Notes\""),
            Some(("receive-pack", "/My Notes".to_string()))
        );
        assert_eq!(parse_git_command("ls -la"), None);
        assert_eq!(parse_git_command("git-upload-pack"), None);
    }

    #[test]
    fn matches_served_repository_paths() {
        let repo = std::path::Path::new("/Users/me/Documents/My Notes");
        assert!(path_matches("/My%20Notes", "My Notes", repo));
        assert!(path_matches("/My Notes", "My Notes", repo));
        assert!(path_matches("/Users/me/Documents/My%20Notes", "My Notes", repo));
        assert!(!path_matches("/Other", "My Notes", repo));
    }

    #[test]
    fn percent_decoding_is_lenient() {
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("a%2Gb"), "a%2Gb");
        assert_eq!(percent_decode("plain"), "plain");
    }
}
