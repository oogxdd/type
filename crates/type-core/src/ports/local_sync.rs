use serde::Serialize;

// ── Types ──────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct LocalSyncServerStatus {
    /// Whether this device can host a server at all (desktop only).
    pub supported: bool,
    /// Whether a usable `git` command-line binary was found.
    pub git_available: bool,
    /// Whether either local-sync daemon currently owns the LAN port.
    pub running: bool,
    /// Whether only the lightweight paired-device request listener is running.
    pub request_listener_running: bool,
    /// Detected LAN / hotspot IPv4 address other devices should connect to.
    pub host: Option<String>,
    /// TCP port the SSH server listens on.
    pub port: u16,
    /// Ready-to-paste `ssh://pair-...@host:port/repo` remote URL for the phone.
    pub ssh_url: Option<String>,
    /// `SHA256:...` fingerprint of the embedded SSH server host key.
    pub host_key_sha256: Option<String>,
    /// Devices whose keys the server accepts (name + when they paired), so the
    /// desktop UI can show that pairing actually happened.
    pub paired_devices: Vec<PairedDeviceInfo>,
    /// Absolute path of the served notes repository.
    pub repo_path: String,
    /// Last non-fatal error (e.g. previous start failure), if any.
    pub error: Option<String>,
}

/// A paired device entry surfaced in [`LocalSyncServerStatus`].
#[derive(Serialize)]
pub struct PairedDeviceInfo {
    pub name: String,
    pub added_ms: i64,
}

// ── Trait ──────────────────────────────────────────────────────────────────────

pub trait LocalSyncServer {
    fn status(&self) -> Result<LocalSyncServerStatus, String>;
    fn start(&self) -> Result<LocalSyncServerStatus, String>;
    fn stop(&self) -> Result<LocalSyncServerStatus, String>;
}

/// Application-facing gateway for the process and mDNS-backed implementation.
pub trait LocalSyncGateway {
    type Status;
    type Discovered;

    fn status(&self) -> Result<Self::Status, String>;
    fn start(&self) -> Result<Self::Status, String>;
    fn start_request_listener(&self) -> Result<Self::Status, String>;
    fn open_window(&self) -> Result<Self::Status, String>;
    fn close_window(&self) -> Result<Self::Status, String>;
    fn approve(&self) -> Result<Self::Status, String>;
    fn decline(&self) -> Result<Self::Status, String>;
    fn stop(&self) -> Result<Self::Status, String>;
    fn discover(&self, timeout_ms: u64) -> Result<Vec<Self::Discovered>, String>;
}

// ─── Implementation Notes ─────────────────────────────────────────────────────
//
// LocalSyncServer lets a desktop machine host its own notes repository over an
// embedded SSH server so a phone on the same network — or connected to the
// phone's personal hotspot — can clone/pull/push without any external remote.
// The QR username carries a pairing token; the phone authenticates with its
// app-managed SSH key, which the desktop stores as an authorized device. A used
// token may remain valid briefly so one scan survives multi-step setup.
//
// This covers the user-facing sync scenarios together with GitSyncService:
//   1. Remote repo            — GitSyncService against an internet remote.
//   2. Local repo over SSH     — this trait runs the app's embedded SSH server;
//                                works on shared Wi-Fi and on iPhone hotspot.
//
// status()
//   in:  nothing
//   out: LocalSyncServerStatus — whether hosting is supported here, whether the
//        git binary exists, whether the daemon is running, and the URLs to use.
//   - supported=false on mobile (a phone never hosts).
//
// start()
//   in:  nothing
//   out: LocalSyncServerStatus — status after the daemon is up.
//   - Ensures the notes folder is a git repo with at least one commit.
//   - Sets `receive.denyCurrentBranch=updateInstead` so a push from the phone
//     updates the desktop's working tree in place (when it is clean).
//   - Starts an SSH server on 0.0.0.0:9418 which executes git-upload-pack /
//     git-receive-pack against the active notes root.
//   - Detects the outbound LAN/hotspot IPv4 and builds the pairing ssh:// URL.
//   - Idempotent: returns the existing status if already running.
//   - Errors clearly if the git binary is missing or the port is in use.
//
// stop()
//   in:  nothing
//   out: LocalSyncServerStatus — status after the daemon is stopped.
//   - Shuts down the server runtime. Safe to call when not running.
//
// Key assumptions for any implementation:
//   - Hosting is desktop-only; mobile reports supported=false.
//   - The served repo is the active profile's notes root (a live working repo,
//     not a bare mirror), so pushes land directly in the user's notes.
//   - Transport is SSH with app-managed key authentication. The host key
//     fingerprint is included in the QR deep link so the phone can pin it.
