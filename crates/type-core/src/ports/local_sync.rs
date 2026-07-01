use serde::Serialize;

// ── Types ──────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct LocalSyncServerStatus {
    /// Whether this device can host a server at all (desktop only).
    pub supported: bool,
    /// Whether a usable `git` command-line binary was found.
    pub git_available: bool,
    /// Whether the local git daemon is currently running.
    pub running: bool,
    /// Detected LAN / hotspot IPv4 address other devices should connect to.
    pub host: Option<String>,
    /// TCP port the daemon listens on (the well-known git:// port, 9418).
    pub port: u16,
    /// Ready-to-paste `git://` remote URL for the phone (when running).
    pub git_url: Option<String>,
    /// Informational `ssh://` remote URL for the same repo (case 2 / Remote Login).
    pub ssh_url: Option<String>,
    /// Absolute path of the served notes repository.
    pub repo_path: String,
    /// Last non-fatal error (e.g. previous start failure), if any.
    pub error: Option<String>,
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
    fn stop(&self) -> Result<Self::Status, String>;
    fn discover(&self, timeout_ms: u64) -> Result<Vec<Self::Discovered>, String>;
}

// ─── Implementation Notes ─────────────────────────────────────────────────────
//
// LocalSyncServer lets a desktop machine host its own notes repository over the
// plain `git://` protocol so a phone on the same network — or connected to the
// phone's personal hotspot — can clone/pull/push without any external remote.
// It supervises a `git daemon` child process pointed at the active profile's
// notes folder.
//
// This covers the user-facing sync scenarios together with GitSyncService:
//   1. Remote repo            — GitSyncService against an internet remote.
//   2. Local repo over SSH     — GitSyncService against ssh://<computer>/...
//                                (server = the computer's built-in sshd; this
//                                trait surfaces the ready-to-use ssh:// URL).
//   3. Local repo over git://  — this trait runs `git daemon` on the computer;
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
//   - Spawns `git daemon` with upload-pack + receive-pack enabled, listening on
//     0.0.0.0:9418, base-path = the notes folder's parent.
//   - Detects the outbound LAN/hotspot IPv4 and builds the git:// URL.
//   - Idempotent: returns the existing status if already running.
//   - Errors clearly if the git binary is missing or the port is in use.
//
// stop()
//   in:  nothing
//   out: LocalSyncServerStatus — status after the daemon is stopped.
//   - Kills the child process. Safe to call when not running.
//
// Key assumptions for any implementation:
//   - Hosting is desktop-only; mobile reports supported=false.
//   - The served repo is the active profile's notes root (a live working repo,
//     not a bare mirror), so pushes land directly in the user's notes.
//   - Transport is unauthenticated plaintext git:// — intended for trusted local
//     networks only. For untrusted networks use ssh:// or https:// instead.
