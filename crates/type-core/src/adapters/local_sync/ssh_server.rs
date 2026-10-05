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
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use russh::keys::PublicKey;
use russh::server::{Auth, ChannelOpenHandle, Config, Handler, Msg, Server, Session};
use russh::{Channel, ChannelId};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, Command};

use super::devices;

/// After one key pairs, libgit2/mobile flows may open another SSH auth session
/// before the UI has switched to the token-less durable remote. Keep the just
/// consumed QR token valid briefly so one scan cannot expire mid-setup.
const CONSUMED_PAIRING_TOKEN_GRACE: Duration = Duration::from_secs(5 * 60);

/// State shared by every client connection of one server run.
pub(super) struct ServerShared {
    pub git_path: PathBuf,
    pub repo_path: PathBuf,
    pub served_name: String,
    pub branch: String,
    /// Current pairing token; rotated in place after each successful pairing,
    /// so the QR (rebuilt from this on every status poll) always shows a live
    /// token while consumed ones only survive a short setup grace window.
    pub pairing_token: Arc<Mutex<String>>,
    pub consumed_pairing_tokens: Arc<Mutex<Vec<(String, Instant)>>>,
    pub pairing_token_path: PathBuf,
    pub devices_path: PathBuf,
    pub operations: Arc<tokio::sync::Mutex<()>>,
    pub maintenance: super::maintenance::Maintenance,
}

pub(super) struct SshServerHandle {
    maintenance: super::maintenance::Maintenance,
    runtime: tokio::runtime::Runtime,
}

impl SshServerHandle {
    pub(super) fn stop(self) {
        // Aborts the accept loop and every in-flight session task.
        self.maintenance.stop();
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
            format!(
                "Port {port} is unavailable ({e}). Stop the other program using it and try again."
            )
        })?;
    let config = Arc::new(Config {
        keys: vec![host_key],
        auth_rejection_time: std::time::Duration::from_millis(300),
        inactivity_timeout: Some(std::time::Duration::from_secs(600)),
        ..Default::default()
    });
    let maintenance = shared.maintenance.clone();
    let mut server = GitSshServer { shared };
    runtime.spawn(async move {
        let _ = server.run_on_socket(config, &listener).await;
    });
    Ok(SshServerHandle {
        maintenance,
        runtime,
    })
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

#[derive(Debug, PartialEq, Eq)]
enum PairingTokenMatch {
    Current(String),
    RecentlyConsumed,
    None,
}

fn pairing_username(token: &str) -> String {
    format!("pair-{token}")
}

fn pairing_token_suffix(token: &str) -> String {
    let reversed: String = token.chars().rev().take(6).collect();
    reversed.chars().rev().collect()
}

fn pairing_user_for_log(user: &str) -> String {
    if let Some(token) = user.strip_prefix("pair-") {
        format!("pair-<token:{}>", pairing_token_suffix(token))
    } else {
        user.to_string()
    }
}

fn recent_pairing_token_count(consumed_tokens: &Arc<Mutex<Vec<(String, Instant)>>>) -> usize {
    let now = Instant::now();
    let Ok(mut consumed) = consumed_tokens.lock() else {
        return 0;
    };
    consumed.retain(|(_, expires_at)| *expires_at > now);
    consumed.len()
}

fn pairing_token_match(
    user: &str,
    current_token: &Arc<Mutex<String>>,
    consumed_tokens: &Arc<Mutex<Vec<(String, Instant)>>>,
) -> PairingTokenMatch {
    let current = current_token
        .lock()
        .map(|token| token.clone())
        .unwrap_or_default();
    if !current.is_empty() && user == pairing_username(&current) {
        return PairingTokenMatch::Current(current);
    }

    let now = Instant::now();
    let Ok(mut consumed) = consumed_tokens.lock() else {
        return PairingTokenMatch::None;
    };
    consumed.retain(|(_, expires_at)| *expires_at > now);
    if consumed
        .iter()
        .any(|(token, _)| user == pairing_username(token))
    {
        PairingTokenMatch::RecentlyConsumed
    } else {
        PairingTokenMatch::None
    }
}

fn remember_consumed_pairing_token(
    consumed_tokens: &Arc<Mutex<Vec<(String, Instant)>>>,
    token: String,
) {
    let Ok(mut consumed) = consumed_tokens.lock() else {
        return;
    };
    let now = Instant::now();
    consumed.retain(|(_, expires_at)| *expires_at > now);
    let expires_at = now + CONSUMED_PAIRING_TOKEN_GRACE;
    if let Some((_, existing_expiry)) = consumed
        .iter_mut()
        .find(|(existing_token, _)| existing_token == &token)
    {
        *existing_expiry = expires_at;
    } else {
        consumed.push((token, expires_at));
    }
}

impl Handler for ClientHandler {
    type Error = russh::Error;

    async fn auth_publickey(&mut self, user: &str, key: &PublicKey) -> Result<Auth, Self::Error> {
        let Some(key_line) = devices::public_key_line(key) else {
            eprintln!("[local-sync] auth rejected: unreadable public key");
            return Ok(reject());
        };
        let key_preview = &key_line[key_line.len().saturating_sub(12)..];
        if devices::is_authorized(&self.shared.devices_path, &key_line) {
            eprintln!(
                "[local-sync] auth ok: paired device key (…{key_preview}) as '{}'",
                pairing_user_for_log(user)
            );
            return Ok(Auth::Accept);
        }
        match pairing_token_match(
            user,
            &self.shared.pairing_token,
            &self.shared.consumed_pairing_tokens,
        ) {
            PairingTokenMatch::Current(matched_token) => {
                let name = devices::device_name_from_key(key);
                match devices::register_device(&self.shared.devices_path, &key_line, &name) {
                    Ok(()) => {
                        // Rotate for the desktop QR, but leave the consumed token
                        // usable for a short grace period. The mobile setup path can
                        // otherwise expire its own QR between connect and first pull.
                        let consumed_suffix = pairing_token_suffix(&matched_token);
                        remember_consumed_pairing_token(
                            &self.shared.consumed_pairing_tokens,
                            matched_token,
                        );
                        let fresh = devices::rotate_pairing_token(&self.shared.pairing_token_path);
                        let fresh_suffix = pairing_token_suffix(&fresh);
                        *self.shared.pairing_token.lock().unwrap() = fresh;
                        eprintln!(
                            "[local-sync] paired new device '{name}' (…{key_preview}) with current QR token pair-<token:{consumed_suffix}>; rotated to pair-<token:{fresh_suffix}>"
                        );
                        return Ok(Auth::Accept);
                    }
                    Err(error) => {
                        eprintln!(
                            "[local-sync] pairing failed: could not store the device key: {error}"
                        );
                        return Ok(reject());
                    }
                }
            }
            PairingTokenMatch::RecentlyConsumed => {
                let name = devices::device_name_from_key(key);
                match devices::register_device(&self.shared.devices_path, &key_line, &name) {
                    Ok(()) => {
                        eprintln!(
                            "[local-sync] paired new device '{name}' (…{key_preview}) with recently consumed QR token '{}'",
                            pairing_user_for_log(user)
                        );
                        return Ok(Auth::Accept);
                    }
                    Err(error) => {
                        eprintln!(
                            "[local-sync] pairing failed: could not store the device key: {error}"
                        );
                        return Ok(reject());
                    }
                }
            }
            PairingTokenMatch::None => {}
        }
        eprintln!(
            "[local-sync] auth rejected: unknown key (…{key_preview}), username '{}' does not match current/recent pairing token (recent_grace_tokens={}) — re-scan the QR code",
            pairing_user_for_log(user),
            recent_pairing_token_count(&self.shared.consumed_pairing_tokens)
        );
        Ok(reject())
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
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
        if !path_matches(
            &requested_path,
            &self.shared.served_name,
            &self.shared.repo_path,
        ) {
            session.channel_success(channel)?;
            fail_channel(session, channel, "Repository not found on this computer.");
            return Ok(());
        }

        static NEXT_CYCLE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let cycle = NEXT_CYCLE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        eprintln!("[local-sync] cycle={cycle} serving {service}");
        // Flush before acquiring any core/Git lock: server -> UI -> core must
        // never form a lock cycle. Concurrent Git children serialize separately
        // from the short worktree writer lock.
        let operation = self.shared.operations.clone().lock_owned().await;
        if let Err(error) = super::events::prepare(&self.shared.repo_path).await {
            session.channel_success(channel)?;
            fail_channel(session, channel, &error);
            return Ok(());
        }
        let shared = self.shared.clone();
        let prepared = tokio::task::spawn_blocking(move || {
            let started = Instant::now();
            let state = crate::application::workspace::workspace_state(&shared.repo_path)?;
            let service =
                crate::application::workspace::with_workspace_write(&shared.repo_path, || {
                    let service = state.begin_git();
                    let repo =
                        git2::Repository::open(&shared.repo_path).map_err(|e| e.to_string())?;
                    crate::commit_all_changes(&repo, "Sync notes", &shared.branch)?;
                    Ok((service, repo.head().ok().and_then(|head| head.target())))
                })?;
            eprintln!(
                "[local-sync] cycle={cycle} serve preparation elapsed_ms={}",
                started.elapsed().as_millis()
            );
            Ok::<_, String>(service)
        })
        .await;
        let (service_guard, head_before) = match prepared {
            Ok(Ok(guard)) => guard,
            Ok(Err(error)) => {
                session.channel_success(channel)?;
                fail_channel(
                    session,
                    channel,
                    &format!("Desktop could not prepare its notes: {error}"),
                );
                return Ok(());
            }
            Err(_) => {
                session.channel_success(channel)?;
                fail_channel(
                    session,
                    channel,
                    "Desktop Git preparation failed. Retry sync.",
                );
                return Ok(());
            }
        };
        let bridge = if service == "receive-pack" {
            match super::checkout::CheckoutBridge::start(
                &self.shared.repo_path,
                &self.shared.git_path,
                cycle,
            ) {
                Ok(bridge) => Some(bridge),
                Err(error) => {
                    session.channel_success(channel)?;
                    fail_channel(
                        session,
                        channel,
                        &format!("Could not prepare safe incoming checkout: {error}"),
                    );
                    return Ok(());
                }
            }
        } else {
            None
        };
        let mut command = Command::new(&self.shared.git_path);
        if let Some(bridge) = &bridge {
            command
                .arg("-c")
                .arg(format!("core.hooksPath={}", bridge.hooks.display()));
        }
        let spawned = command
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
        pump_child_io(
            session,
            channel,
            child,
            service,
            self.shared.clone(),
            operation,
            service_guard,
            bridge,
            cycle,
            head_before,
        );
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
/// exit status and close the channel. A completed receive-pack changed the
/// live working tree, so the desktop UI is notified to refresh.
fn pump_child_io(
    session: &mut Session,
    channel: ChannelId,
    mut child: Child,
    service: &'static str,
    shared: Arc<ServerShared>,
    operation: tokio::sync::OwnedMutexGuard<()>,
    service_guard: crate::application::workspace::GitService,
    bridge: Option<super::checkout::CheckoutBridge>,
    cycle: u64,
    head_before: Option<git2::Oid>,
) {
    let handle = session.handle();
    let started_at = std::time::Instant::now();
    tokio::spawn(async move {
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let out_handle = handle.clone();
        let out_task = async move {
            let Some(mut stdout) = stdout else { return };
            let mut buf = vec![0u8; 32 * 1024];
            let mut forwarding = true;
            loop {
                match stdout.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if forwarding
                            && out_handle
                                .data(channel, Vec::from(&buf[..n]))
                                .await
                                .is_err()
                        {
                            forwarding = false;
                        }
                    }
                }
            }
        };
        let err_handle = handle.clone();
        let err_task = async move {
            let Some(mut stderr) = stderr else { return };
            let mut buf = vec![0u8; 8 * 1024];
            let mut forwarding = true;
            loop {
                match stderr.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if forwarding
                            && err_handle
                                .extended_data(channel, 1, Vec::from(&buf[..n]))
                                .await
                                .is_err()
                        {
                            forwarding = false;
                        }
                    }
                }
            }
        };
        let wait_task = async move {
            let code = child
                .wait()
                .await
                .ok()
                .and_then(|status| status.code())
                .unwrap_or(1) as u32;
            eprintln!(
            "[local-sync] cycle={cycle} git process finished with exit code {code}; service={service} elapsed_ms={}",
            started_at.elapsed().as_millis()
        );
            // Releases checkout/ref-update tail even when the task is cancelled.
            drop(bridge);
            let root = shared.repo_path.clone();
            let head_after = if service == "receive-pack" && code == 0 {
                tokio::task::spawn_blocking(move || {
                    git2::Repository::open(root)
                        .ok()
                        .and_then(|repo| repo.head().ok().and_then(|head| head.target()))
                })
                .await
                .ok()
                .flatten()
            } else {
                None
            };
            drop(service_guard);
            drop(operation);
            if service == "receive-pack" && code == 0 && head_after != head_before {
                eprintln!(
                    "[local-sync] cycle={cycle} push received — notifying the app to refresh notes"
                );
                super::notify_local_sync_push_received(&shared.repo_path);
                shared.maintenance.request();
            }
            code
        };
        let (_, _, code) = tokio::join!(out_task, err_task, wait_task);
        let close_started_at = std::time::Instant::now();
        let _ = handle.exit_status_request(channel, code).await;
        let _ = handle.eof(channel).await;
        let _ = handle.close(channel).await;
        eprintln!(
            "[local-sync] cycle={cycle} {service} channel close finished in {}ms",
            close_started_at.elapsed().as_millis()
        );
    });
}

/// Send a git-visible error message and close the channel with exit status 128.
fn fail_channel(session: &mut Session, channel: ChannelId, message: &str) {
    let handle = session.handle();
    let message = format!("{message}\n");
    tokio::spawn(async move {
        let _ = handle.extended_data(channel, 1, message.into_bytes()).await;
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
pub(super) fn path_matches(
    requested: &str,
    served_name: &str,
    repo_path: &std::path::Path,
) -> bool {
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
    use std::fs;
    use std::path::Path;

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
        assert!(path_matches(
            "/Users/me/Documents/My%20Notes",
            "My Notes",
            repo
        ));
        assert!(!path_matches("/Other", "My Notes", repo));
    }

    #[test]
    fn percent_decoding_is_lenient() {
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("a%2Gb"), "a%2Gb");
        assert_eq!(percent_decode("plain"), "plain");
    }

    /// End-to-end: a real `git` client pairs with the embedded server over SSH
    /// (unknown key + pairing-token username), clones, pushes, and the push
    /// updates the served working tree via receive.denyCurrentBranch.
    #[test]
    fn real_git_client_pairs_clones_and_pushes() {
        use rand_core::OsRng;
        use ssh_key::{Algorithm, LineEnding, PrivateKey};
        use std::process::Command as StdCommand;

        let Some(git) = super::super::locate_git() else {
            eprintln!("skipping: git binary not found");
            return;
        };
        let ssh_available = StdCommand::new("ssh")
            .arg("-V")
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);
        if !ssh_available {
            eprintln!("skipping: ssh client not found");
            return;
        }

        let base = std::env::temp_dir().join(format!(
            "type-ssh-e2e-{}",
            devices::generate_pairing_token()
        ));
        let repo_path = base.join("notes");
        fs::create_dir_all(repo_path.join("_system/stream")).unwrap();
        fs::write(
            repo_path.join("_system/stream").join("note.md"),
            "hello from desktop\n",
        )
        .unwrap();
        fs::create_dir_all(repo_path.join(".type")).unwrap();
        fs::write(repo_path.join(".type").join("settings.json"), "{}\n").unwrap();

        for index in 0..6600 {
            fs::write(
                repo_path.join(format!("_system/stream/n-{index:04}.md")),
                format!("synthetic {index}\n{}", "markdown body\n".repeat(75)),
            )
            .unwrap();
        }
        let push_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = push_count.clone();
        let subscribed_root = repo_path.clone();
        let _subscription = super::super::subscribe_local_sync_events(move |event| match event {
            super::super::LocalSyncEvent::Push { root } if root == subscribed_root => {
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
            super::super::LocalSyncEvent::Prepare { reply, .. } => {
                let _ = reply.send(Ok(()));
            }
            _ => {}
        });
        // Mirror start_local_sync_server_impl's repo preparation.
        let repo = crate::ensure_git_repo(&repo_path).unwrap();
        repo.config()
            .and_then(|mut cfg| cfg.set_str("receive.denyCurrentBranch", "updateInstead"))
            .unwrap();
        let branch = crate::resolve_target_branch(&repo, None);
        crate::switch_or_prepare_branch(&repo, &branch).unwrap();
        crate::commit_all_changes(&repo, "Initial local sync commit", &branch).unwrap();
        drop(repo);

        // Host + client keys, exchanged as OpenSSH text like production.
        let host_key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        let host_key_text = host_key.to_openssh(LineEnding::LF).unwrap().to_string();
        let mut client_key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        client_key.set_comment("test-phone");
        let client_key_path = base.join("client_key");
        fs::write(
            &client_key_path,
            client_key.to_openssh(LineEnding::LF).unwrap().as_bytes(),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&client_key_path, fs::Permissions::from_mode(0o600)).unwrap();
        }

        let port = {
            let probe = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
            probe.local_addr().unwrap().port()
        };
        let token = devices::generate_pairing_token();
        let token_path = base.join("pairing_token");
        fs::write(&token_path, &token).unwrap();
        let live_token = Arc::new(Mutex::new(token.clone()));
        let devices_path = base.join("devices.json");
        let (scan_entered, scan_started) = std::sync::mpsc::channel();
        let (release_scan, scan_release) = std::sync::mpsc::channel();
        let mut first_scan = Some(scan_release);
        let maintenance =
            super::super::maintenance::Maintenance::with_scan_probe(repo_path.clone(), move || {
                if let Some(release) = first_scan.take() {
                    let _ = scan_entered.send(());
                    let _ = release.recv();
                }
            })
            .unwrap();
        maintenance.request();
        scan_started.recv_timeout(Duration::from_secs(5)).unwrap();
        let server = start_ssh_server(
            Arc::new(ServerShared {
                git_path: git.clone(),
                repo_path: repo_path.clone(),
                served_name: "notes".to_string(),
                branch: branch.clone(),
                pairing_token: live_token.clone(),
                consumed_pairing_tokens: Arc::new(Mutex::new(Vec::new())),
                pairing_token_path: token_path.clone(),
                devices_path: devices_path.clone(),
                operations: Arc::new(tokio::sync::Mutex::new(())),
                maintenance: maintenance.clone(),
            }),
            &host_key_text,
            port,
        )
        .unwrap();

        let ssh_command = format!(
            "ssh -i {} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile={} -o ConnectTimeout=5",
            client_key_path.display(),
            base.join("known_hosts").display()
        );
        let remote = format!("ssh://pair-{token}@127.0.0.1:{port}/notes");
        let clone_path = base.join("clone");
        let run_git = |args: &[&str], cwd: &Path| {
            let started = Instant::now();
            let out = StdCommand::new(&git)
                .args(args)
                .current_dir(cwd)
                .env("GIT_SSH_COMMAND", &ssh_command)
                .env("GIT_TERMINAL_PROMPT", "0")
                .output()
                .unwrap();
            eprintln!(
                "[sync-benchmark] operation={} elapsed_ms={}",
                args[0],
                started.elapsed().as_millis()
            );
            assert!(
                out.status.success(),
                "git {args:?} failed:\n{}\n{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
        };

        // Clone pairs the unknown key via the token username.
        run_git(&["clone", &remote, clone_path.to_str().unwrap()], &base);
        assert!(clone_path.join("_system/stream").join("note.md").exists());
        assert!(
            devices::is_authorized(
                &devices_path,
                &devices::normalize_key_line(&client_key.public_key().to_openssh().unwrap())
                    .unwrap()
            ),
            "pairing should register the client key"
        );
        // A successful pairing consumes the token: rotated in memory + on disk.
        let rotated = live_token.lock().unwrap().clone();
        assert_ne!(rotated, token, "pairing should rotate the token");
        assert_eq!(fs::read_to_string(&token_path).unwrap().trim(), rotated);

        // Mobile setup can perform more than one SSH auth session from the
        // scanned URL before it persists the durable token-less remote. The
        // just-consumed token should keep pairing briefly instead of expiring
        // between connect and first pull.
        let mut retry_key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        retry_key.set_comment("retry-phone");
        let retry_priv = base.join("retry_key");
        fs::write(
            &retry_priv,
            retry_key.to_openssh(LineEnding::LF).unwrap().as_bytes(),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&retry_priv, fs::Permissions::from_mode(0o600)).unwrap();
        }
        let retry_pub = base.join("retry_key.pub");
        fs::write(
            &retry_pub,
            format!("{}\n", retry_key.public_key().to_openssh().unwrap()),
        )
        .unwrap();
        let retry_root = base.join("retry");
        fs::create_dir_all(&retry_root).unwrap();
        let retry_repo = crate::ensure_git_repo(&retry_root).unwrap();
        crate::ensure_origin_remote(&retry_repo, &remote).unwrap();
        crate::perform_fetch(
            &retry_repo,
            &branch,
            None,
            None,
            Some(retry_priv),
            Some(retry_pub),
            None,
        )
        .unwrap();
        assert!(
            devices::is_authorized(
                &devices_path,
                &devices::normalize_key_line(&retry_key.public_key().to_openssh().unwrap())
                    .unwrap()
            ),
            "recently consumed QR token should still register setup retries"
        );

        // Uncommitted desktop edits are committed at serve time, so a pull
        // picks them up without anyone pressing a button on the desktop.
        fs::write(
            repo_path.join("_system/stream").join("fresh.md"),
            "typed after clone\n",
        )
        .unwrap();
        run_git(&["pull", "origin", &branch], &clone_path);
        assert!(
            clone_path.join("_system/stream").join("fresh.md").exists(),
            "pull should receive desktop edits committed at serve time"
        );

        // Push from the clone updates the served working tree (updateInstead).
        fs::write(
            clone_path.join("_system/stream").join("phone.md"),
            "hello from phone\n",
        )
        .unwrap();
        run_git(&["add", "-A"], &clone_path);
        run_git(
            &[
                "-c",
                "user.name=Test Phone",
                "-c",
                "user.email=phone@test",
                "commit",
                "-m",
                "phone note",
            ],
            &clone_path,
        );
        run_git(&["push", "origin", &branch], &clone_path);
        assert!(
            repo_path.join("_system/stream").join("phone.md").exists(),
            "push should update the desktop working tree in place"
        );

        assert_eq!(
            push_count.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "push event must precede SSH completion"
        );
        release_scan.send(()).unwrap();
        // Warm one-note delta, deletion, rename and synced metadata on a fully
        // populated base; the child transfers only new Git objects.
        fs::write(clone_path.join("_system/stream/n-0000.md"), "daily edit\n").unwrap();
        fs::remove_file(clone_path.join("_system/stream/n-0001.md")).unwrap();
        fs::rename(
            clone_path.join("_system/stream/n-0002.md"),
            clone_path.join("_system/stream/moved.md"),
        )
        .unwrap();
        fs::write(
            clone_path.join(".type/settings.json"),
            "{\"transcription_mode\":\"off\"}\n",
        )
        .unwrap();
        fs::write(
            clone_path.join(".notes-order.json"),
            "{\"folders\":[],\"notes\":[]}\n",
        )
        .unwrap();
        run_git(&["add", "-A"], &clone_path);
        run_git(
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@test",
                "commit",
                "-m",
                "daily delta",
            ],
            &clone_path,
        );
        run_git(&["push", "origin", &branch], &clone_path);
        assert_eq!(
            fs::read_to_string(repo_path.join("_system/stream/n-0000.md")).unwrap(),
            "daily edit\n"
        );
        assert!(!repo_path.join("_system/stream/n-0001.md").exists());
        assert!(repo_path.join("_system/stream/moved.md").exists());
        assert!(fs::read_to_string(repo_path.join(".type/settings.json"))
            .unwrap()
            .contains("off"));
        assert!(repo_path.join(".notes-order.json").exists());
        assert_eq!(push_count.load(std::sync::atomic::Ordering::SeqCst), 2);
        run_git(&["push", "origin", &branch], &clone_path); // zero-delta cycle
        assert_eq!(
            push_count.load(std::sync::atomic::Ordering::SeqCst),
            2,
            "zero-delta push must not invalidate UI or receipts"
        );
        // Preparation errors are visible to Git, not ignored.
        fs::write(
            repo_path.join("_system/stream/prepare-error.md"),
            "pending desktop\n",
        )
        .unwrap();
        fs::write(repo_path.join(".git/index.lock"), "locked for regression").unwrap();
        let failed = StdCommand::new(&git)
            .args(["pull", "origin", &branch])
            .current_dir(&clone_path)
            .env("GIT_SSH_COMMAND", &ssh_command)
            .output()
            .unwrap();
        assert!(!failed.status.success());
        assert!(String::from_utf8_lossy(&failed.stderr).contains("could not prepare"));
        fs::remove_file(repo_path.join(".git/index.lock")).unwrap();
        run_git(&["pull", "origin", &branch], &clone_path);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // A custom pre-receive creates a *late* desktop edit, after serve
            // preparation. Checkout must reject and retain both histories.
            let hook = repo_path.join(".git/hooks/pre-receive");
            fs::write(
                &hook,
                "#!/bin/sh\nprintf 'late desktop edit\n' > ../_system/stream/fresh.md\n",
            )
            .unwrap();
            fs::set_permissions(&hook, fs::Permissions::from_mode(0o700)).unwrap();
            fs::write(clone_path.join("_system/stream/retry.md"), "phone retry\n").unwrap();
            run_git(&["add", "-A"], &clone_path);
            run_git(
                &[
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@test",
                    "commit",
                    "-m",
                    "retry",
                ],
                &clone_path,
            );
            let before = git2::Repository::open(&repo_path)
                .unwrap()
                .head()
                .unwrap()
                .target();
            let failed = StdCommand::new(&git)
                .args(["push", "origin", &branch])
                .current_dir(&clone_path)
                .env("GIT_SSH_COMMAND", &ssh_command)
                .output()
                .unwrap();
            assert!(!failed.status.success(), "late edits must reject checkout");
            assert_eq!(
                push_count.load(std::sync::atomic::Ordering::SeqCst),
                2,
                "a rejected ref update is not an incoming change"
            );
            assert_eq!(
                git2::Repository::open(&repo_path)
                    .unwrap()
                    .head()
                    .unwrap()
                    .target(),
                before
            );
            assert_eq!(
                fs::read_to_string(repo_path.join("_system/stream/fresh.md")).unwrap(),
                "late desktop edit\n"
            );
            assert!(clone_path.join("_system/stream/retry.md").exists());
            fs::remove_file(hook).unwrap();
            run_git(
                &[
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@test",
                    "-c",
                    "pull.rebase=false",
                    "pull",
                    "origin",
                    &branch,
                ],
                &clone_path,
            );
            run_git(&["push", "origin", &branch], &clone_path);
            assert!(repo_path.join("_system/stream/retry.md").exists());
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let entered = base.join("post-entered");
            let release = base.join("post-release");
            let hook = repo_path.join(".git/hooks/post-receive");
            fs::write(
                &hook,
                format!(
                    "#!/bin/sh\n: > {}\nwhile [ ! -f {} ]; do sleep 0.02; done\n",
                    super::super::checkout::shell_quote(&entered),
                    super::super::checkout::shell_quote(&release)
                ),
            )
            .unwrap();
            fs::set_permissions(&hook, fs::Permissions::from_mode(0o700)).unwrap();
            fs::write(
                clone_path.join("_system/stream/post.md"),
                "phone post-hook test\n",
            )
            .unwrap();
            run_git(&["add", "-A"], &clone_path);
            run_git(
                &[
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@test",
                    "commit",
                    "-m",
                    "post hook",
                ],
                &clone_path,
            );
            let push_git = git.clone();
            let push_root = clone_path.clone();
            let push_ssh = ssh_command.clone();
            let push_branch = branch.clone();
            let push = std::thread::spawn(move || {
                StdCommand::new(push_git)
                    .args(["push", "origin", &push_branch])
                    .current_dir(push_root)
                    .env("GIT_SSH_COMMAND", push_ssh)
                    .output()
                    .unwrap()
            });
            let wait_started = Instant::now();
            while !entered.exists() {
                assert!(
                    wait_started.elapsed() < Duration::from_secs(10),
                    "custom post hook must run"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
            let (saved, saving) = std::sync::mpsc::channel();
            let writer_root = repo_path.clone();
            let writer = std::thread::spawn(move || {
                let result =
                    crate::application::workspace::with_workspace_write(&writer_root, || {
                        fs::write(
                            writer_root.join("_system/stream/after-apply.md"),
                            "desktop edits during slow post hook\n",
                        )
                        .map_err(|e| e.to_string())
                    });
                let _ = saved.send(result);
            });
            // Detect a lock spanning a slow custom post hook, rather than
            // asserting a platform-specific number of milliseconds.
            let result = saving.recv_timeout(Duration::from_secs(5));
            fs::write(&release, "release").unwrap();
            let pushed = push.join().unwrap();
            writer.join().unwrap();
            result
                .expect("autosave must remain available after ref update")
                .unwrap();
            assert!(
                pushed.status.success(),
                "{}",
                String::from_utf8_lossy(&pushed.stderr)
            );
            assert!(repo_path.join("_system/stream/post.md").exists());
            assert!(repo_path.join("_system/stream/after-apply.md").exists());
            fs::remove_file(hook).unwrap();
        }

        // Regression: a libgit2 client fetching over the *durable* remote —
        // an ssh:// URL without a username — must authenticate with the paired
        // key file. The positional attempt counter used to skip the key file
        // after libgit2's username-query round, so exactly this fetch failed
        // with "server rejected this device's key" on devices with no
        // ssh-agent (every phone).
        let durable_root = base.join("durable");
        fs::create_dir_all(&durable_root).unwrap();
        let durable_repo = crate::ensure_git_repo(&durable_root).unwrap();
        crate::ensure_origin_remote(&durable_repo, &format!("ssh://127.0.0.1:{port}/notes"))
            .unwrap();
        crate::perform_fetch(
            &durable_repo,
            &branch,
            None,
            None,
            Some(client_key_path.clone()),
            None,
            None,
        )
        .unwrap_or_else(|error| {
            panic!("usernameless durable remote should fetch with the paired key: {error}")
        });

        // Regression: a libgit2 client with an unpaired key and a stale token
        // must fail fast with pairing guidance — before the credentials
        // callback was attempt-bounded this looped forever ("Pulling…" hang).
        let mut stranger = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        stranger.set_comment("stranger");
        let stranger_priv = base.join("stranger_key");
        fs::write(
            &stranger_priv,
            stranger.to_openssh(LineEnding::LF).unwrap().as_bytes(),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&stranger_priv, fs::Permissions::from_mode(0o600)).unwrap();
        }
        let stranger_pub = base.join("stranger_key.pub");
        fs::write(
            &stranger_pub,
            format!("{}\n", stranger.public_key().to_openssh().unwrap()),
        )
        .unwrap();
        let stranger_root = base.join("stranger");
        fs::create_dir_all(&stranger_root).unwrap();
        let stranger_repo = crate::ensure_git_repo(&stranger_root).unwrap();
        crate::ensure_origin_remote(
            &stranger_repo,
            &format!("ssh://pair-{}@127.0.0.1:{port}/notes", "deadbeef"),
        )
        .unwrap();
        let error = match crate::perform_fetch(
            &stranger_repo,
            &branch,
            None,
            None,
            Some(stranger_priv),
            Some(stranger_pub),
            None,
        ) {
            Ok(_) => panic!("fetch with an unpaired key should fail"),
            Err(error) => error,
        };
        assert!(
            error.contains("not paired"),
            "unpaired key should fail with pairing guidance, got: {error}"
        );

        server.stop();
        let _ = fs::remove_dir_all(&base);
    }
}
