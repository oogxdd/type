//! Local-network ("LAN" / iPhone-hotspot) Git server.
//!
//! Lets a desktop machine host its own notes repository over the plain `git://`
//! protocol with a single button, so a phone on the same Wi-Fi — or connected to
//! the phone's personal hotspot — can clone/pull/push without any external
//! remote. Implemented by supervising a `git daemon` child process pointed at the
//! active profile's notes folder.
//!
//! Hosting requires the `git` command-line binary and is desktop-only; on mobile
//! the commands report `supported = false`.

use crate::AppEnv;
use serde::Serialize;

use mdns_sd::{ServiceDaemon, ServiceEvent};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use crate::ensured_notes_root;
use crate::ports::local_sync::LocalSyncGateway;

#[cfg(desktop)]
use crate::{commit_all_changes, ensure_git_repo, resolve_target_branch, switch_or_prepare_branch};
#[cfg(desktop)]
use std::{
    net::{IpAddr, TcpListener, UdpSocket},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};

/// Default git-daemon port (the well-known `git://` port).
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
    pub host: Option<String>,
    pub port: u16,
    pub branch: Option<String>,
    pub git_url: Option<String>,
    pub ssh_url: Option<String>,
    pub repo_path: String,
    pub error: Option<String>,
}

/// A server found on the local network via mDNS.
#[derive(Serialize, Clone)]
pub struct DiscoveredServer {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub git_url: String,
    pub branch: String,
}

// ── Running daemon state ─────────────────────────────────────────────────────

#[cfg(desktop)]
struct RunningDaemon {
    child: Child,
    host: Option<String>,
    served_name: String,
    branch: String,
    repo_path: PathBuf,
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

    fn stop(&self) -> Result<Self::Status, String> {
        stop_local_sync_server_impl(&self.app)
    }

    fn discover(&self, timeout_ms: u64) -> Result<Vec<Self::Discovered>, String> {
        discover_local_sync_servers_impl(timeout_ms)
    }
}

// ── Public API (called by the command layer) ─────────────────────────────────

pub fn local_sync_server_status(
    app: &AppEnv,
) -> Result<LocalSyncServerStatus, String> {
    let repo_path = ensured_notes_root(app)?.to_string_lossy().to_string();

    #[cfg(not(desktop))]
    {
        Ok(unsupported_status(repo_path))
    }

    #[cfg(desktop)]
    {
        let mut guard = DAEMON
            .lock()
            .map_err(|_| "local sync server state is poisoned".to_string())?;
        // Reap a daemon that exited on its own (crash, killed externally).
        if let Some(daemon) = guard.as_mut() {
            if matches!(daemon.child.try_wait(), Ok(Some(_))) {
                *guard = None;
            }
        }
        let git_available = locate_git().is_some();
        Ok(match guard.as_ref() {
            Some(daemon) => running_status(daemon),
            None => idle_status(git_available, repo_path),
        })
    }
}

pub fn start_local_sync_server_impl(
    app: &AppEnv,
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

        let mut guard = DAEMON
            .lock()
            .map_err(|_| "local sync server state is poisoned".to_string())?;

        // Already running? Return current status (idempotent).
        if let Some(daemon) = guard.as_mut() {
            if matches!(daemon.child.try_wait(), Ok(None)) {
                return Ok(running_status(daemon));
            }
            // Dead handle — drop it and restart below.
            *guard = None;
        }

        // Make sure the notes folder is a repo, has a commit to clone, and will
        // accept pushes to its checked-out branch by updating the working tree.
        let repo = ensure_git_repo(&root)?;
        repo.config()
            .and_then(|mut cfg| cfg.set_str("receive.denyCurrentBranch", "updateInstead"))
            .map_err(|e| format!("Failed to configure repo for local sync: {e}"))?;
        let branch = resolve_target_branch(&repo, None);
        switch_or_prepare_branch(&repo, &branch)?;
        // Best-effort initial commit so the phone can pull existing notes; a
        // brand-new empty repo is fine too (the phone can push to create it).
        let _ = commit_all_changes(&repo, "Initial local sync commit", &branch);
        drop(repo);

        let parent = root
            .parent()
            .ok_or_else(|| "Notes folder has no parent directory.".to_string())?;
        let served_name = root
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Notes folder name is not valid UTF-8.".to_string())?
            .to_string();

        // Pre-flight: give a clear error if the port is already taken.
        match TcpListener::bind(("0.0.0.0", LOCAL_SYNC_PORT)) {
            Ok(listener) => drop(listener),
            Err(e) => {
                return Err(format!(
                    "Port {LOCAL_SYNC_PORT} is already in use ({e}). Stop any other git daemon and try again."
                ))
            }
        }

        let mut child = Command::new(&git)
            .arg("daemon")
            .arg("--reuseaddr")
            .arg("--export-all")
            .arg("--enable=upload-pack")
            .arg("--enable=receive-pack")
            .arg(format!("--base-path={}", parent.display()))
            .arg("--listen=0.0.0.0")
            .arg(format!("--port={LOCAL_SYNC_PORT}"))
            .arg(parent)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start git daemon: {e}"))?;

        // Catch an immediate exit (e.g. invalid args / bind race).
        std::thread::sleep(Duration::from_millis(150));
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "git daemon exited immediately (status {:?}). Port {LOCAL_SYNC_PORT} may be in use.",
                status.code()
            ));
        }

        // Advertise over mDNS so phones can auto-discover this server without
        // typing or scanning anything. Best-effort: failure never blocks hosting.
        let host = detect_lan_ip();
        let mdns = host.as_ref().and_then(|ip| {
            let git_url = format!("git://{ip}/{served_name}");
            advertise_mdns(ip, &served_name, &branch, &git_url)
        });

        let daemon = RunningDaemon {
            child,
            host,
            served_name,
            branch,
            repo_path: root,
            mdns,
        };
        let status = running_status(&daemon);
        *guard = Some(daemon);
        Ok(status)
    }
}

pub fn stop_local_sync_server_impl(
    app: &AppEnv,
) -> Result<LocalSyncServerStatus, String> {
    #[cfg(not(desktop))]
    {
        let _ = app;
        Err(NOT_SUPPORTED_MSG.to_string())
    }

    #[cfg(desktop)]
    {
        if let Ok(mut guard) = DAEMON.lock() {
            if let Some(daemon) = guard.take() {
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

/// Stop the mDNS advertisement (if any) and kill the git daemon child.
#[cfg(desktop)]
fn teardown_daemon(mut daemon: RunningDaemon) {
    if let Some(advert) = daemon.mdns.take() {
        let _ = advert.daemon.unregister(&advert.fullname);
        let _ = advert.daemon.shutdown();
    }
    let _ = daemon.child.kill();
    let _ = daemon.child.wait();
}

// ── Status builders ──────────────────────────────────────────────────────────

#[cfg(not(desktop))]
fn unsupported_status(repo_path: String) -> LocalSyncServerStatus {
    LocalSyncServerStatus {
        supported: false,
        git_available: false,
        running: false,
        host: None,
        port: LOCAL_SYNC_PORT,
        branch: None,
        git_url: None,
        ssh_url: None,
        repo_path,
        error: None,
    }
}

#[cfg(desktop)]
fn idle_status(git_available: bool, repo_path: String) -> LocalSyncServerStatus {
    LocalSyncServerStatus {
        supported: true,
        git_available,
        running: false,
        host: None,
        port: LOCAL_SYNC_PORT,
        branch: None,
        git_url: None,
        ssh_url: None,
        repo_path,
        error: None,
    }
}

#[cfg(desktop)]
fn running_status(daemon: &RunningDaemon) -> LocalSyncServerStatus {
    let git_url = daemon
        .host
        .as_ref()
        .map(|host| format!("git://{host}/{}", daemon.served_name));
    let ssh_url = daemon.host.as_ref().map(|host| {
        format!(
            "ssh://{}@{host}{}",
            current_user(),
            daemon.repo_path.display()
        )
    });
    LocalSyncServerStatus {
        supported: true,
        git_available: true,
        running: true,
        host: daemon.host.clone(),
        port: LOCAL_SYNC_PORT,
        branch: Some(daemon.branch.clone()),
        git_url,
        ssh_url,
        repo_path: daemon.repo_path.to_string_lossy().to_string(),
        error: None,
    }
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
    git_url: &str,
) -> Option<MdnsAdvert> {
    use mdns_sd::ServiceInfo;

    let daemon = ServiceDaemon::new().ok()?;
    let label = computer_label();
    // host_name owns the A record we publish for `host`; it just has to be unique.
    let host_name = format!("{}.local.", sanitize_host_label(&label));
    let properties = [
        ("url", git_url),
        ("branch", branch),
        ("path", served_name),
        ("name", label.as_str()),
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
pub fn discover_local_sync_servers_impl(
    timeout_ms: u64,
) -> Result<Vec<DiscoveredServer>, String> {
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
    let git_url = info
        .get_property_val_str("url")
        .map(|value| value.to_string())
        .unwrap_or_else(|| format!("git://{host}/{path}"));
    let branch = info
        .get_property_val_str("branch")
        .unwrap_or("main")
        .to_string();
    let name = info
        .get_property_val_str("name")
        .map(|value| value.to_string())
        .unwrap_or_else(|| info.fullname.clone());
    Some(DiscoveredServer {
        name,
        host,
        port: info.port,
        git_url,
        branch,
    })
}
