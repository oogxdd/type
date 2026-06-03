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

use serde::Serialize;

use crate::ensured_notes_root;

#[cfg(desktop)]
use crate::{commit_all_changes, ensure_git_repo, resolve_target_branch, switch_or_prepare_branch};
#[cfg(desktop)]
use std::{
    net::{IpAddr, TcpListener, UdpSocket},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

/// Default git-daemon port (the well-known `git://` port).
pub(crate) const LOCAL_SYNC_PORT: u16 = 9418;

#[cfg(desktop)]
const GIT_MISSING_MSG: &str = "Hosting a local sync server needs the Git command-line tools. On macOS install them with: xcode-select --install";

#[cfg(not(desktop))]
const NOT_SUPPORTED_MSG: &str = "Hosting a local sync server is only available in the desktop app.";

#[derive(Serialize, Clone)]
pub(crate) struct LocalSyncServerStatus {
    pub supported: bool,
    pub git_available: bool,
    pub running: bool,
    pub host: Option<String>,
    pub port: u16,
    pub git_url: Option<String>,
    pub ssh_url: Option<String>,
    pub repo_path: String,
    pub error: Option<String>,
}

// ── Running daemon state ─────────────────────────────────────────────────────

#[cfg(desktop)]
struct RunningDaemon {
    child: Child,
    host: Option<String>,
    served_name: String,
    repo_path: PathBuf,
}

#[cfg(desktop)]
static DAEMON: Mutex<Option<RunningDaemon>> = Mutex::new(None);

// ── Public API (called by the command layer) ─────────────────────────────────

pub(crate) fn local_sync_server_status(
    app: &tauri::AppHandle,
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

pub(crate) fn start_local_sync_server_impl(
    app: &tauri::AppHandle,
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

        let daemon = RunningDaemon {
            child,
            host: detect_lan_ip(),
            served_name,
            repo_path: root,
        };
        let status = running_status(&daemon);
        *guard = Some(daemon);
        Ok(status)
    }
}

pub(crate) fn stop_local_sync_server_impl(
    app: &tauri::AppHandle,
) -> Result<LocalSyncServerStatus, String> {
    #[cfg(not(desktop))]
    {
        let _ = app;
        Err(NOT_SUPPORTED_MSG.to_string())
    }

    #[cfg(desktop)]
    {
        if let Ok(mut guard) = DAEMON.lock() {
            if let Some(mut daemon) = guard.take() {
                let _ = daemon.child.kill();
                let _ = daemon.child.wait();
            }
        }
        local_sync_server_status(app)
    }
}

/// Kill the daemon on app exit. Safe to call when nothing is running.
#[cfg(desktop)]
pub(crate) fn shutdown_local_sync_server() {
    if let Ok(mut guard) = DAEMON.lock() {
        if let Some(mut daemon) = guard.take() {
            let _ = daemon.child.kill();
            let _ = daemon.child.wait();
        }
    }
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
    let ssh_url = daemon
        .host
        .as_ref()
        .map(|host| format!("ssh://{}@{host}{}", current_user(), daemon.repo_path.display()));
    LocalSyncServerStatus {
        supported: true,
        git_available: true,
        running: true,
        host: daemon.host.clone(),
        port: LOCAL_SYNC_PORT,
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
    candidates
        .into_iter()
        .map(PathBuf::from)
        .find(|candidate| {
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
