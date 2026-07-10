//! Local-network ("LAN" / iPhone-hotspot) SSH Git server.
//!
//! Lets a desktop machine host its notes repository over an embedded SSH server
//! with QR-based key pairing, so a phone on the same Wi-Fi or hotspot can
//! clone/pull/push without an external remote, macOS Remote Login, or
//! plaintext `git://`.
//!
//! Hosting requires the `git` command-line binary for `git-upload-pack` /
//! `git-receive-pack` and is desktop-only; on mobile the commands report
//! `supported = false`.

use crate::AppEnv;
use serde::Serialize;

use mdns_sd::{ServiceDaemon, ServiceEvent};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use crate::ports::local_sync::LocalSyncGateway;
use crate::{app_data_dir, ensured_notes_root, load_app_config};

#[cfg(desktop)]
mod devices;
#[cfg(desktop)]
mod ssh_server;

#[cfg(desktop)]
use crate::{ensure_git_repo, resolve_target_branch, switch_or_prepare_branch};
#[cfg(desktop)]
use std::{
    net::{IpAddr, UdpSocket},
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
};

/// Default local-sync port. It intentionally reuses the old git-daemon port so
/// existing firewall prompts/rules continue to apply, but the protocol is SSH.
pub const LOCAL_SYNC_PORT: u16 = 9418;

/// Bonjour/mDNS service type the desktop advertises and clients browse for.
const MDNS_SERVICE_TYPE: &str = "_typenotes-sync._tcp.local.";

#[cfg(desktop)]
const GIT_MISSING_MSG: &str = "Hosting a local sync server needs the Git command-line tools. On macOS install them with: xcode-select --install";

#[cfg(not(desktop))]
const NOT_SUPPORTED_MSG: &str = "Hosting a local sync server is only available in the desktop app.";

#[derive(Serialize, Clone)]
pub struct LocalSyncServerStatus {
    pub supported: bool,
    pub git_available: bool,
    pub running: bool,
    /// Whether Git fetch/push commands are currently allowed.
    pub sync_window_open: bool,
    /// Seconds until the window closes if no further sync completes.
    pub sync_window_seconds_remaining: u64,
    /// Configured inactivity timeout used for approved windows.
    pub idle_timeout_minutes: u64,
    /// Paired device currently waiting for a desktop decision.
    pub pending_request: Option<PendingLocalSyncRequest>,
    pub host: Option<String>,
    pub port: u16,
    pub branch: Option<String>,
    pub ssh_url: Option<String>,
    pub host_key_sha256: Option<String>,
    pub paired_devices: Vec<PairedDeviceInfo>,
    pub repo_path: String,
    pub error: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct PendingLocalSyncRequest {
    pub device_name: String,
    pub requested_ms: i64,
}

/// A phone whose key the sync server accepts (shown on the desktop card so
/// pairing success is visible).
#[derive(Serialize, Clone)]
pub struct PairedDeviceInfo {
    pub name: String,
    pub added_ms: i64,
}

/// A server found on the local network via mDNS.
#[derive(Serialize, Clone)]
pub struct DiscoveredServer {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub url: String,
    pub branch: String,
    pub host_key_sha256: Option<String>,
}

// ── Running daemon state ─────────────────────────────────────────────────────

#[cfg(desktop)]
struct RunningDaemon {
    server: ssh_server::SshServerHandle,
    host: Option<String>,
    served_name: String,
    branch: String,
    repo_path: PathBuf,
    /// Shared with the SSH server, which rotates it after each pairing —
    /// status polls read the live value so the QR always shows a valid token.
    pairing_token: std::sync::Arc<Mutex<String>>,
    devices_path: PathBuf,
    host_key_sha256: String,
    access: Arc<ssh_server::SyncAccessState>,
    /// mDNS advertisement handle, present when discovery is active.
    mdns: Option<MdnsAdvert>,
}

#[cfg(desktop)]
struct MdnsAdvert {
    daemon: ServiceDaemon,
    fullname: String,
}

#[cfg(desktop)]
static DAEMON: Mutex<Option<RunningDaemon>> = Mutex::new(None);

/// Called after the embedded server accepts a push from a phone. A push lands
/// files in the live working tree completely outside the frontend's view, so
/// the shell registers a listener here (a Tauri event emitter) and refreshes
/// the notes UI — otherwise incoming notes stay invisible until app restart.
#[cfg(desktop)]
static PUSH_LISTENER: Mutex<Option<Box<dyn Fn() + Send + Sync>>> = Mutex::new(None);

#[cfg(desktop)]
static REQUEST_LISTENER: Mutex<Option<Box<dyn Fn(PendingLocalSyncRequest) + Send + Sync>>> =
    Mutex::new(None);

#[cfg(desktop)]
pub fn set_local_sync_push_listener(listener: Box<dyn Fn() + Send + Sync>) {
    if let Ok(mut guard) = PUSH_LISTENER.lock() {
        *guard = Some(listener);
    }
}

#[cfg(desktop)]
fn notify_local_sync_push_received() {
    if let Ok(guard) = PUSH_LISTENER.lock() {
        if let Some(listener) = guard.as_ref() {
            listener();
        }
    }
}

#[cfg(desktop)]
pub fn set_local_sync_request_listener(
    listener: Box<dyn Fn(PendingLocalSyncRequest) + Send + Sync>,
) {
    if let Ok(mut guard) = REQUEST_LISTENER.lock() {
        *guard = Some(listener);
    }
}

#[cfg(desktop)]
fn notify_local_sync_request(request: PendingLocalSyncRequest) {
    if let Ok(guard) = REQUEST_LISTENER.lock() {
        if let Some(listener) = guard.as_ref() {
            listener(request);
        }
    }
}

/// Core local-sync gateway. Child-process and mDNS state stay in this
/// outer adapter rather than leaking into commands or application services.
pub struct LocalSyncAdapter {
    app: AppEnv,
}

impl LocalSyncAdapter {
    pub fn new(app: AppEnv) -> Self {
        Self { app }
    }
}

impl LocalSyncGateway for LocalSyncAdapter {
    type Status = LocalSyncServerStatus;
    type Discovered = DiscoveredServer;

    fn status(&self) -> Result<Self::Status, String> {
        local_sync_server_status(&self.app)
    }

    fn start(&self) -> Result<Self::Status, String> {
        start_local_sync_server_impl(&self.app)
    }

    fn start_request_listener(&self) -> Result<Self::Status, String> {
        start_local_sync_request_listener_impl(&self.app)
    }

    fn open_window(&self) -> Result<Self::Status, String> {
        open_local_sync_window_impl(&self.app)
    }

    fn close_window(&self) -> Result<Self::Status, String> {
        close_local_sync_window_impl(&self.app)
    }

    fn approve(&self) -> Result<Self::Status, String> {
        approve_local_sync_request_impl(&self.app)
    }

    fn decline(&self) -> Result<Self::Status, String> {
        decline_local_sync_request_impl(&self.app)
    }

    fn stop(&self) -> Result<Self::Status, String> {
        stop_local_sync_server_impl(&self.app)
    }

    fn discover(&self, timeout_ms: u64) -> Result<Vec<Self::Discovered>, String> {
        discover_local_sync_servers_impl(timeout_ms)
    }
}

// ── Public API (called by the command layer) ─────────────────────────────────

pub fn local_sync_server_status(app: &AppEnv) -> Result<LocalSyncServerStatus, String> {
    let repo_path = ensured_notes_root(app)?.to_string_lossy().to_string();

    #[cfg(not(desktop))]
    {
        Ok(unsupported_status(repo_path))
    }

    #[cfg(desktop)]
    {
        let guard = DAEMON
            .lock()
            .map_err(|_| "local sync server state is poisoned".to_string())?;
        let git_available = locate_git().is_some();
        let idle_timeout_minutes = configured_idle_timeout_minutes(app);
        Ok(match guard.as_ref() {
            Some(daemon) => running_status(daemon),
            None => idle_status(git_available, repo_path, idle_timeout_minutes),
        })
    }
}

pub fn start_local_sync_server_impl(app: &AppEnv) -> Result<LocalSyncServerStatus, String> {
    start_local_sync_server_with_access(app, true)
}

pub fn start_local_sync_request_listener_impl(
    app: &AppEnv,
) -> Result<LocalSyncServerStatus, String> {
    start_local_sync_server_with_access(app, false)
}

fn start_local_sync_server_with_access(
    app: &AppEnv,
    open_immediately: bool,
) -> Result<LocalSyncServerStatus, String> {
    #[cfg(not(desktop))]
    {
        let _ = app;
        Err(NOT_SUPPORTED_MSG.to_string())
    }

    #[cfg(desktop)]
    {
        let root = ensured_notes_root(app)?;
        let git = locate_git().ok_or_else(|| GIT_MISSING_MSG.to_string())?;
        let idle_timeout = Duration::from_secs(configured_idle_timeout_minutes(app) * 60);
        eprintln!("[local-sync] start requested: repo='{}'", root.display());

        let mut guard = DAEMON
            .lock()
            .map_err(|_| "local sync server state is poisoned".to_string())?;

        // Already serving this profile? Return current status (idempotent).
        if let Some(daemon) = guard.as_ref().filter(|daemon| {
            daemon.repo_path == root && daemon.access.idle_timeout == idle_timeout
        }) {
            if open_immediately {
                daemon.access.open_window();
            }
            eprintln!(
                "[local-sync] start skipped: server already running for repo='{}' branch='{}'",
                daemon.repo_path.display(),
                daemon.branch
            );
            return Ok(running_status(daemon));
        }
        // Profile switches replace the listener so mDNS and Git always point
        // at the active working folder.
        if let Some(previous) = guard.take() {
            eprintln!(
                "[local-sync] active repo changed: '{}' -> '{}'",
                previous.repo_path.display(),
                root.display()
            );
            teardown_daemon(previous);
        }

        // Make sure the notes folder is a repo and will accept pushes to its
        // checked-out branch by updating the working tree. Pending desktop
        // edits are committed by the server just before it serves each fetch
        // or push (see ssh_server), so starting — including the settings
        // page's auto-start — never creates commits by itself.
        let repo = ensure_git_repo(&root)?;
        repo.config()
            .and_then(|mut cfg| cfg.set_str("receive.denyCurrentBranch", "updateInstead"))
            .map_err(|e| format!("Failed to configure repo for local sync: {e}"))?;
        let branch = resolve_target_branch(&repo, None);
        switch_or_prepare_branch(&repo, &branch)?;
        drop(repo);

        let served_name = root
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Notes folder name is not valid UTF-8.".to_string())?
            .to_string();

        let (host_key, host_key_sha256) = devices::ensure_host_key(app)?;
        let (token_path, token) = devices::load_or_create_pairing_token(app)?;
        let pairing_token = Arc::new(Mutex::new(token));
        let consumed_pairing_tokens = Arc::new(Mutex::new(Vec::new()));
        let devices_path = devices::devices_path(app)?;
        let access = Arc::new(ssh_server::SyncAccessState::new(
            idle_timeout,
            open_immediately,
        ));
        let shared = Arc::new(ssh_server::ServerShared {
            git_path: git,
            repo_path: root.clone(),
            served_name: served_name.clone(),
            branch: branch.clone(),
            pairing_token: pairing_token.clone(),
            consumed_pairing_tokens,
            pairing_token_path: token_path,
            devices_path: devices_path.clone(),
            access: access.clone(),
        });
        let server = ssh_server::start_ssh_server(shared, &host_key, LOCAL_SYNC_PORT)?;

        // Advertise over mDNS so phones can auto-discover this server without
        // typing or scanning anything. Best-effort: failure never blocks hosting.
        // The advertised URL deliberately omits the pairing token: mDNS is
        // plaintext broadcast, and the token must stay QR-only (already-paired
        // devices authenticate by key under any username).
        let host = detect_lan_ip();
        let mdns = host.as_ref().and_then(|ip| {
            let ssh_url = ssh_public_url(ip, &served_name);
            advertise_mdns(ip, &served_name, &branch, &ssh_url, &host_key_sha256)
        });

        let daemon = RunningDaemon {
            server,
            host,
            served_name,
            branch,
            repo_path: root,
            pairing_token,
            devices_path,
            host_key_sha256,
            access,
            mdns,
        };
        let status = running_status(&daemon);
        eprintln!(
            "[local-sync] server running: listen=0.0.0.0:{LOCAL_SYNC_PORT} advertised_host={} branch='{}' repo='{}' paired_devices={}",
            daemon.host.as_deref().unwrap_or("<unknown>"),
            daemon.branch,
            daemon.repo_path.display(),
            status.paired_devices.len()
        );
        *guard = Some(daemon);
        Ok(status)
    }
}

pub fn open_local_sync_window_impl(app: &AppEnv) -> Result<LocalSyncServerStatus, String> {
    #[cfg(not(desktop))]
    {
        let _ = app;
        Err(NOT_SUPPORTED_MSG.to_string())
    }
    #[cfg(desktop)]
    {
        let should_start = DAEMON.lock().map(|guard| guard.is_none()).unwrap_or(true);
        if should_start {
            return start_local_sync_server_with_access(app, true);
        }
        if let Ok(guard) = DAEMON.lock() {
            if let Some(daemon) = guard.as_ref() {
                daemon.access.open_window();
            }
        }
        local_sync_server_status(app)
    }
}

pub fn close_local_sync_window_impl(app: &AppEnv) -> Result<LocalSyncServerStatus, String> {
    #[cfg(not(desktop))]
    {
        let _ = app;
        Err(NOT_SUPPORTED_MSG.to_string())
    }
    #[cfg(desktop)]
    {
        if let Ok(guard) = DAEMON.lock() {
            if let Some(daemon) = guard.as_ref() {
                daemon.access.close_window();
            }
        }
        local_sync_server_status(app)
    }
}

pub fn approve_local_sync_request_impl(app: &AppEnv) -> Result<LocalSyncServerStatus, String> {
    open_local_sync_window_impl(app)
}

pub fn decline_local_sync_request_impl(app: &AppEnv) -> Result<LocalSyncServerStatus, String> {
    #[cfg(not(desktop))]
    {
        let _ = app;
        Err(NOT_SUPPORTED_MSG.to_string())
    }
    #[cfg(desktop)]
    {
        if let Ok(guard) = DAEMON.lock() {
            if let Some(daemon) = guard.as_ref() {
                daemon.access.decline();
            }
        }
        local_sync_server_status(app)
    }
}

pub fn stop_local_sync_server_impl(app: &AppEnv) -> Result<LocalSyncServerStatus, String> {
    #[cfg(not(desktop))]
    {
        let _ = app;
        Err(NOT_SUPPORTED_MSG.to_string())
    }

    #[cfg(desktop)]
    {
        if let Ok(mut guard) = DAEMON.lock() {
            if let Some(daemon) = guard.take() {
                eprintln!(
                    "[local-sync] stop requested: repo='{}' branch='{}'",
                    daemon.repo_path.display(),
                    daemon.branch
                );
                teardown_daemon(daemon);
            }
        }
        local_sync_server_status(app)
    }
}

/// Kill the daemon on app exit. Safe to call when nothing is running.
#[cfg(desktop)]
pub fn shutdown_local_sync_server() {
    if let Ok(mut guard) = DAEMON.lock() {
        if let Some(daemon) = guard.take() {
            teardown_daemon(daemon);
        }
    }
}

/// Stop the mDNS advertisement (if any) and shut down the embedded SSH server.
#[cfg(desktop)]
fn teardown_daemon(mut daemon: RunningDaemon) {
    if let Some(advert) = daemon.mdns.take() {
        let _ = advert.daemon.unregister(&advert.fullname);
        let _ = advert.daemon.shutdown();
    }
    daemon.server.stop();
}

// ── Status builders ──────────────────────────────────────────────────────────

#[cfg(not(desktop))]
fn unsupported_status(repo_path: String) -> LocalSyncServerStatus {
    LocalSyncServerStatus {
        supported: false,
        git_available: false,
        running: false,
        sync_window_open: false,
        sync_window_seconds_remaining: 0,
        idle_timeout_minutes: 10,
        pending_request: None,
        host: None,
        port: LOCAL_SYNC_PORT,
        branch: None,
        ssh_url: None,
        host_key_sha256: None,
        paired_devices: Vec::new(),
        repo_path,
        error: None,
    }
}

#[cfg(desktop)]
fn idle_status(
    git_available: bool,
    repo_path: String,
    idle_timeout_minutes: u64,
) -> LocalSyncServerStatus {
    LocalSyncServerStatus {
        supported: true,
        git_available,
        running: false,
        sync_window_open: false,
        sync_window_seconds_remaining: 0,
        idle_timeout_minutes,
        pending_request: None,
        host: None,
        port: LOCAL_SYNC_PORT,
        branch: None,
        ssh_url: None,
        host_key_sha256: None,
        paired_devices: Vec::new(),
        repo_path,
        error: None,
    }
}

#[cfg(desktop)]
fn running_status(daemon: &RunningDaemon) -> LocalSyncServerStatus {
    let access = daemon.access.snapshot();
    let token = daemon
        .pairing_token
        .lock()
        .map(|t| t.clone())
        .unwrap_or_default();
    let ssh_url = daemon
        .host
        .as_ref()
        .map(|host| ssh_pairing_url(host, &daemon.served_name, &token));
    let paired_devices = devices::list_devices(&daemon.devices_path)
        .into_iter()
        .map(|device| PairedDeviceInfo {
            name: device.name,
            added_ms: device.added_ms,
        })
        .collect();
    LocalSyncServerStatus {
        supported: true,
        git_available: true,
        running: true,
        sync_window_open: access.window_open,
        sync_window_seconds_remaining: access.seconds_remaining,
        idle_timeout_minutes: configured_timeout_from_duration(daemon.access.idle_timeout),
        pending_request: access.pending_request,
        host: daemon.host.clone(),
        port: LOCAL_SYNC_PORT,
        branch: Some(daemon.branch.clone()),
        ssh_url,
        host_key_sha256: Some(daemon.host_key_sha256.clone()),
        paired_devices,
        repo_path: daemon.repo_path.to_string_lossy().to_string(),
        error: None,
    }
}

#[cfg(desktop)]
fn configured_idle_timeout_minutes(app: &AppEnv) -> u64 {
    app_data_dir(app)
        .map(|path| load_app_config(&path).local_sync_idle_timeout_minutes)
        .unwrap_or(10)
        .clamp(1, 60)
}

#[cfg(desktop)]
fn configured_timeout_from_duration(duration: Duration) -> u64 {
    duration.as_secs().div_ceil(60)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Locate a usable `git` binary: PATH first, then common GUI-app install spots
/// (Finder/Dock-launched apps get a minimal PATH, mirroring whisper_env).
#[cfg(desktop)]
fn locate_git() -> Option<PathBuf> {
    let candidates = [
        "git",
        "/usr/bin/git",
        "/opt/homebrew/bin/git",
        "/usr/local/bin/git",
    ];
    candidates.into_iter().map(PathBuf::from).find(|candidate| {
        Command::new(candidate)
            .arg("--version")
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    })
}

/// Best-effort detection of the outbound LAN/hotspot IPv4. Uses the classic
/// "connected UDP socket" trick: connecting does a route lookup and reveals the
/// source address for that route without sending any packets. We probe a few
/// targets so it works on shared Wi-Fi, on iPhone hotspot (gateway 172.20.10.1),
/// and on networks without internet access.
#[cfg(desktop)]
fn detect_lan_ip() -> Option<String> {
    const TARGETS: [&str; 5] = [
        "8.8.8.8:80",
        "1.1.1.1:80",
        "172.20.10.1:80", // iPhone personal-hotspot gateway
        "192.168.1.1:80",
        "192.168.0.1:80",
    ];
    for target in TARGETS {
        let Ok(socket) = UdpSocket::bind("0.0.0.0:0") else {
            continue;
        };
        if socket.connect(target).is_err() {
            continue;
        }
        if let Ok(addr) = socket.local_addr() {
            if let IpAddr::V4(v4) = addr.ip() {
                if !v4.is_loopback() && !v4.is_unspecified() {
                    return Some(v4.to_string());
                }
            }
        }
    }
    None
}

#[cfg(desktop)]
fn current_user() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "user".to_string())
}

#[cfg(desktop)]
fn ssh_pairing_url(host: &str, served_name: &str, pairing_token: &str) -> String {
    format!(
        "ssh://pair-{pairing_token}@{host}:{LOCAL_SYNC_PORT}/{}",
        encode_url_path_segment(served_name)
    )
}

/// Token-less variant, safe for plaintext broadcast (mDNS). Only devices whose
/// keys are already paired can use it.
#[cfg(desktop)]
fn ssh_public_url(host: &str, served_name: &str) -> String {
    format!(
        "ssh://{host}:{LOCAL_SYNC_PORT}/{}",
        encode_url_path_segment(served_name)
    )
}

#[cfg(desktop)]
fn encode_url_path_segment(value: &str) -> String {
    let mut output = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            output.push(byte as char);
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }
    output
}

/// Human-friendly label for this computer, shown on the phone's discovery list.
#[cfg(desktop)]
fn computer_label() -> String {
    // macOS: the user-set "Computer Name" is the friendliest.
    if let Ok(out) = Command::new("scutil")
        .arg("--get")
        .arg("ComputerName")
        .output()
    {
        if out.status.success() {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    if let Ok(out) = Command::new("hostname").output() {
        if out.status.success() {
            let name = String::from_utf8_lossy(&out.stdout)
                .trim()
                .trim_end_matches(".local")
                .to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    format!("{}'s computer", current_user())
}

/// DNS-label-safe version of a free-text name (for the mDNS host name).
#[cfg(desktop)]
fn sanitize_host_label(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "type-sync".to_string()
    } else {
        trimmed
    }
}

/// Register an mDNS service for the running server. Returns a handle to keep the
/// advertisement alive; dropping/unregistering it removes the service.
#[cfg(desktop)]
fn advertise_mdns(
    host: &str,
    served_name: &str,
    branch: &str,
    remote_url: &str,
    host_key_sha256: &str,
) -> Option<MdnsAdvert> {
    use mdns_sd::ServiceInfo;

    let daemon = ServiceDaemon::new().ok()?;
    let label = computer_label();
    // host_name owns the A record we publish for `host`; it just has to be unique.
    let host_name = format!("{}.local.", sanitize_host_label(&label));
    let properties = [
        ("url", remote_url),
        ("branch", branch),
        ("path", served_name),
        ("name", label.as_str()),
        ("transport", "ssh"),
        ("host_key_sha256", host_key_sha256),
    ];
    let info = ServiceInfo::new(
        MDNS_SERVICE_TYPE,
        &label,
        &host_name,
        host,
        LOCAL_SYNC_PORT,
        &properties[..],
    )
    .ok()?;
    let fullname = info.get_fullname().to_string();
    daemon.register(info).ok()?;
    Some(MdnsAdvert { daemon, fullname })
}

// ── Discovery (all platforms) ────────────────────────────────────────────────

/// Browse the local network for advertised sync servers for up to `timeout_ms`.
pub fn discover_local_sync_servers_impl(timeout_ms: u64) -> Result<Vec<DiscoveredServer>, String> {
    let timeout_ms = timeout_ms.clamp(500, 10_000);
    let mdns = ServiceDaemon::new().map_err(|e| format!("mDNS init failed: {e}"))?;
    let receiver = mdns
        .browse(MDNS_SERVICE_TYPE)
        .map_err(|e| format!("mDNS browse failed: {e}"))?;

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let mut found: HashMap<String, DiscoveredServer> = HashMap::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match receiver.recv_timeout(remaining) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                if let Some(server) = discovered_from_info(&info) {
                    found.insert(info.fullname.clone(), server);
                }
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = mdns.shutdown();

    let mut servers: Vec<DiscoveredServer> = found.into_values().collect();
    servers.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(servers)
}

fn discovered_from_info(info: &mdns_sd::ResolvedService) -> Option<DiscoveredServer> {
    let host = info
        .get_addresses_v4()
        .into_iter()
        .next()
        .map(|v4| v4.to_string())?;
    let path = info.get_property_val_str("path").unwrap_or("notes");
    let url = info
        .get_property_val_str("url")
        .map(|value| value.to_string())
        .unwrap_or_else(|| format!("ssh://{host}:{}/{path}", info.port));
    let branch = info
        .get_property_val_str("branch")
        .unwrap_or("main")
        .to_string();
    let name = info
        .get_property_val_str("name")
        .map(|value| value.to_string())
        .unwrap_or_else(|| info.fullname.clone());
    let host_key_sha256 = info
        .get_property_val_str("host_key_sha256")
        .map(|value| value.to_string());
    Some(DiscoveredServer {
        name,
        host,
        port: info.port,
        url,
        branch,
        host_key_sha256,
    })
}
