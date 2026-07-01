use serde::Serialize;

// ── Types ──────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct GitSyncStatus {
    pub git_available: bool,
    pub repo_initialized: bool,
    pub current_branch: Option<String>,
    pub remote_url: Option<String>,
    pub has_uncommitted_changes: bool,
    pub push_required: bool,
    pub ahead: usize,
    pub behind: usize,
    pub notes_root: String,
}

#[derive(Serialize)]
pub struct GitCommitEntry {
    pub id: String,
    pub short_id: String,
    pub summary: String,
    pub author: String,
    pub authored_ms: Option<i64>,
    pub sync_state: String,
    pub is_head: bool,
}

// ── Trait ──────────────────────────────────────────────────────────────────────

pub trait GitSyncService {
    fn get_status(&self) -> Result<GitSyncStatus, String>;
    fn get_history(&self, limit: Option<usize>) -> Result<Vec<GitCommitEntry>, String>;
    fn connect(
        &self,
        remote_url: &str,
        branch: Option<&str>,
        username: Option<&str>,
        password: Option<&str>,
    ) -> Result<GitSyncStatus, String>;
    fn pull(
        &self,
        branch: Option<&str>,
        username: Option<&str>,
        password: Option<&str>,
    ) -> Result<GitSyncStatus, String>;
    fn push(
        &self,
        message: Option<&str>,
        branch: Option<&str>,
        username: Option<&str>,
        password: Option<&str>,
    ) -> Result<GitSyncStatus, String>;
    fn generate_ssh_key(&self) -> Result<String, String>;
    fn get_ssh_public_key(&self) -> Result<Option<String>, String>;
    fn delete_ssh_key(&self) -> Result<(), String>;
}

/// Internal gateway for libgit2 and SSH-key infrastructure.
pub(crate) trait GitSyncGateway {
    type Status;
    type HistoryArgs;
    type History;
    type ConnectArgs;
    type PullArgs;
    type PushArgs;

    fn generate_ssh_key(&self) -> Result<String, String>;
    fn ssh_public_key(&self) -> Result<Option<String>, String>;
    fn delete_ssh_key(&self) -> Result<(), String>;
    fn status(&self) -> Result<Self::Status, String>;
    fn history(&self, args: Option<Self::HistoryArgs>) -> Result<Vec<Self::History>, String>;
    fn connect(&self, args: Self::ConnectArgs) -> Result<Self::Status, String>;
    fn pull(&self, args: Self::PullArgs) -> Result<Self::Status, String>;
    fn push(&self, args: Self::PushArgs) -> Result<Self::Status, String>;
}

// ─── Implementation Notes ─────────────────────────────────────────────────────
//
// GitSyncService provides git-based sync for notes across devices.
// Supports both HTTPS (username/password) and SSH (keypair) authentication.
//
// get_status()
//   in:  nothing
//   out: GitSyncStatus — repo state, branch, remote, uncommitted changes, ahead/behind counts
//   - Returns git_available=true if git2 can open a repo (always true in the Rust impl)
//   - repo_initialized=false if no .git directory exists
//   - push_required=true if there are uncommitted changes, local-only commits, or no upstream
//
// get_history(limit)
//   in:  limit — max number of commits to return, defaults to 40, clamped to 1-200
//   out: Vec<GitCommitEntry> — commit list with sync state
//   - Walks the git log in topological + time order
//   - sync_state is "synced" if the commit is reachable from the upstream, "local" otherwise
//   - is_head marks the current HEAD commit
//
// connect(remote_url, branch, username, password)
//   in:  remote_url — git remote URL (HTTPS or SSH)
//        branch — target branch name, defaults to current branch or "main"
//        username, password — optional HTTPS credentials
//   out: GitSyncStatus — status after connecting
//   - Initializes a git repo if none exists
//   - Sets or updates the "origin" remote URL
//   - Fetches from the remote and fast-forwards if possible
//   - On first sync with an empty local repo, clears bootstrap artifacts so remote content wins
//   - Uses the app's SSH keypair if available (for SSH URLs)
//
// pull(branch, username, password)
//   in:  branch — target branch, defaults to current
//        username, password — optional HTTPS credentials
//   out: GitSyncStatus — status after pulling
//   - Fails if there are uncommitted local changes
//   - Fetches and performs fast-forward, or three-way merge if needed
//   - On merge conflicts: keeps "ours", saves "theirs" as .conflict files (e.g. note.conflict.md)
//   - Never loses data — conflict files preserve the remote version
//
// push(message, branch, username, password)
//   in:  message — commit message, defaults to "Sync notes"
//        branch — target branch, defaults to current
//        username, password — optional HTTPS credentials
//   out: GitSyncStatus — status after pushing
//   - Stages all changes and commits
//   - Pushes to the remote
//   - Sets upstream tracking on the branch
//   - No-op if push_required is false
//
// generate_ssh_key()
//   in:  nothing
//   out: String — the public key text
//   - Generates an Ed25519 keypair using ssh-keygen
//   - Stored in app_data/ssh/{id_ed25519, id_ed25519.pub}
//   - Private key has restricted permissions (0o600 on Unix)
//   - Fails if a key already exists (delete first)
//
// get_ssh_public_key()
//   in:  nothing
//   out: Option<String> — the public key text, or None if no key exists
//
// delete_ssh_key()
//   in:  nothing
//   out: nothing
//   - Removes both private and public key files
//
// Key assumptions for any implementation:
//   - Git repo lives at the notes root directory
//   - Remote is always named "origin"
//   - Authentication: HTTPS (username/password) or SSH (app-managed Ed25519 keypair)
//   - Conflict resolution creates .conflict sibling files instead of losing data
//   - Commit author defaults to "Type Notes Sync <sync@local>"
//   - Timestamps from git history can supplement note front-matter timestamps
