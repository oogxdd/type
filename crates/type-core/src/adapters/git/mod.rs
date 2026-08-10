//! Git operations: repo init, fetch, push, merge, status, history.

use crate::AppEnv;
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use git2::{
    build::CheckoutBuilder, AnnotatedCommit, CertificateCheckStatus, Cred, CredentialType,
    Direction, FetchOptions, IndexAddOption, Oid, PushOptions, RemoteCallbacks, Repository,
    ResetType, Signature, Sort, StatusOptions,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    net::{IpAddr, TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    time::Duration,
};

use crate::ports::git_sync::GitSyncGateway;
use crate::{is_system_folder_name, ORDER_FILE, PROTECTED_SYSTEM_FOLDERS};

mod ssh_keys;
pub use ssh_keys::{
    delete_ssh_keypair, generate_ssh_keypair, read_ssh_public_key, ssh_private_key_if_exists,
    ssh_public_key_if_exists,
};

// ── Types ──────────────────────────────────────────────────────────────────────

/// Git sync status snapshot returned to the frontend.
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

/// Single commit entry in the git history list.
#[derive(Serialize)]
pub struct GitCommitHistoryEntry {
    pub id: String,
    pub short_id: String,
    pub summary: String,
    pub author: String,
    pub authored_ms: Option<i64>,
    pub sync_state: String,
    pub is_head: bool,
}

/// Arguments for connecting to a remote git repository.
#[derive(Deserialize)]
pub struct ConnectGitArgs {
    pub remote_url: Option<String>,
    pub branch: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
}

/// Arguments for a fetch-merge-push sync cycle.
#[derive(Deserialize)]
pub struct GitSyncArgs {
    pub branch: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
}

/// Arguments for committing and pushing local changes.
#[derive(Deserialize)]
pub struct GitPushArgs {
    pub message: Option<String>,
    pub branch: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Clone)]
pub struct TrustedSshHostKey {
    host: String,
    sha256: String,
}

/// Arguments for fetching commit history.
#[derive(Deserialize)]
pub struct GitHistoryArgs {
    pub limit: Option<usize>,
}

/// Core Git sync gateway. libgit2 operations, SSH key lookup, and notes
/// root resolution remain in this outer adapter.
pub struct GitSyncAdapter {
    app: AppEnv,
}

impl GitSyncAdapter {
    pub fn new(app: AppEnv) -> Self {
        Self { app }
    }

    fn resolve_settings(&self) -> (PathBuf, crate::ProfileSettings) {
        let root = crate::ensured_notes_root(&self.app).unwrap_or_default();
        let settings = crate::load_profile_settings(&root);
        (root, settings)
    }
}

impl GitSyncGateway for GitSyncAdapter {
    type Status = GitSyncStatus;
    type HistoryArgs = GitHistoryArgs;
    type History = GitCommitHistoryEntry;
    type ConnectArgs = ConnectGitArgs;
    type PullArgs = GitSyncArgs;
    type PushArgs = GitPushArgs;

    fn generate_ssh_key(&self) -> Result<String, String> {
        generate_ssh_keypair(&self.app)
    }

    fn ssh_public_key(&self) -> Result<Option<String>, String> {
        read_ssh_public_key(&self.app)
    }

    fn delete_ssh_key(&self) -> Result<(), String> {
        delete_ssh_keypair(&self.app)
    }

    fn status(&self) -> Result<Self::Status, String> {
        let (root, _) = self.resolve_settings();
        Ok(build_git_status(&root))
    }

    fn history(&self, args: Option<Self::HistoryArgs>) -> Result<Vec<Self::History>, String> {
        let (root, _) = self.resolve_settings();
        let limit = args.and_then(|value| value.limit).unwrap_or(40);
        build_git_history(&root, limit)
    }

    fn connect(&self, args: Self::ConnectArgs) -> Result<Self::Status, String> {
        let (root, settings) = self.resolve_settings();

        let remote_url = args
            .remote_url
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(settings.git_remote_url.as_str());
        if remote_url.is_empty() {
            return Err("Remote URL is required.".to_string());
        }

        let branch = args
            .branch
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(settings.git_branch.as_str());

        let username = args
            .username
            .as_deref()
            .filter(|s| !s.is_empty())
            .or_else(|| {
                if !settings.git_username.is_empty() {
                    Some(settings.git_username.as_str())
                } else {
                    None
                }
            });

        let password = args
            .password
            .as_deref()
            .filter(|s| !s.is_empty())
            .or_else(|| {
                if !settings.git_password.is_empty() {
                    Some(settings.git_password.as_str())
                } else {
                    None
                }
            });

        let repo = ensure_git_repo(&root)?;
        // Record the remote before anything that can fail, so a half-finished
        // connect (network down, permission prompt pending, …) leaves a state
        // the next pull/push can recover from instead of a repo with no origin.
        ensure_origin_remote(&repo, remote_url)?;
        let target_branch = resolve_target_branch(&repo, Some(branch.to_string()));
        prepare_bootstrap_worktree_for_sync(&root, &repo, &target_branch)?;
        probe_remote_url(remote_url)?;
        switch_or_prepare_branch(&repo, &target_branch)?;
        let ssh_priv = ssh_private_key_if_exists(&self.app);
        let ssh_pub = ssh_public_key_if_exists(&self.app);
        let trusted_host_key = trusted_ssh_host_key_from_settings(&settings);
        let fetched = match perform_fetch(
            &repo,
            &target_branch,
            username,
            password,
            ssh_priv,
            ssh_pub,
            trusted_host_key,
        ) {
            Ok(commit) => Some(commit),
            Err(error) => {
                let lower = error.to_lowercase();
                if lower.contains("couldn't find remote ref") {
                    None
                } else {
                    return Err(error);
                }
            }
        };
        if let Some(fetched_commit) = fetched {
            let analysis = repo
                .merge_analysis(&[&fetched_commit])
                .map_err(map_git_error)?
                .0;
            if analysis.is_fast_forward() || analysis.is_up_to_date() {
                fast_forward_to(&repo, &target_branch, &fetched_commit)?;
            }
        }
        Ok(build_git_status(&root))
    }

    fn pull(&self, args: Self::PullArgs) -> Result<Self::Status, String> {
        let (root, settings) = self.resolve_settings();
        if !git_repo_initialized(&root) {
            return Err("Repository is not initialized. Connect a remote first.".to_string());
        }

        let branch = args
            .branch
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(settings.git_branch.as_str());

        let username = args
            .username
            .as_deref()
            .filter(|s| !s.is_empty())
            .or_else(|| {
                if !settings.git_username.is_empty() {
                    Some(settings.git_username.as_str())
                } else {
                    None
                }
            });

        let password = args
            .password
            .as_deref()
            .filter(|s| !s.is_empty())
            .or_else(|| {
                if !settings.git_password.is_empty() {
                    Some(settings.git_password.as_str())
                } else {
                    None
                }
            });

        let repo = open_repo(&root)?;
        let target_branch = resolve_target_branch(&repo, Some(branch.to_string()));
        prepare_bootstrap_worktree_for_sync(&root, &repo, &target_branch)?;
        // Files are the source of truth and merges never block: pending local
        // edits are committed (exactly like push does) instead of failing the
        // pull, so the one-button pull-then-push sync just works.
        if git_has_changes(&repo) {
            let message = if settings.git_commit_message.trim().is_empty() {
                "Sync notes"
            } else {
                settings.git_commit_message.as_str()
            };
            commit_all_changes(&repo, message, &target_branch)?;
        }
        if let Some(remote_url) = git_remote_url(&repo) {
            probe_remote_url(&remote_url)?;
        }
        switch_or_prepare_branch(&repo, &target_branch)?;
        let ssh_priv = ssh_private_key_if_exists(&self.app);
        let ssh_pub = ssh_public_key_if_exists(&self.app);
        let trusted_host_key = trusted_ssh_host_key_from_settings(&settings);
        let fetched = perform_fetch(
            &repo,
            &target_branch,
            username,
            password,
            ssh_priv,
            ssh_pub,
            trusted_host_key,
        )?;
        let (analysis, _) = repo.merge_analysis(&[&fetched]).map_err(map_git_error)?;
        if analysis.is_up_to_date() {
            return Ok(build_git_status(&root));
        }
        if analysis.is_fast_forward() {
            fast_forward_to(&repo, &target_branch, &fetched)?;
            return Ok(build_git_status(&root));
        }
        if analysis.is_normal() {
            merge_fetched_commit(&repo, &target_branch, &fetched)?;
            return Ok(build_git_status(&root));
        }
        Err("Pull failed because local and remote history could not be merged.".to_string())
    }

    fn push(&self, args: Self::PushArgs) -> Result<Self::Status, String> {
        let (root, settings) = self.resolve_settings();
        if !git_repo_initialized(&root) {
            return Err("Repository is not initialized. Connect a remote first.".to_string());
        }

        let branch = args
            .branch
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(settings.git_branch.as_str());

        let username = args
            .username
            .as_deref()
            .filter(|s| !s.is_empty())
            .or_else(|| {
                if !settings.git_username.is_empty() {
                    Some(settings.git_username.as_str())
                } else {
                    None
                }
            });

        let password = args
            .password
            .as_deref()
            .filter(|s| !s.is_empty())
            .or_else(|| {
                if !settings.git_password.is_empty() {
                    Some(settings.git_password.as_str())
                } else {
                    None
                }
            });

        let commit_message = args
            .message
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(settings.git_commit_message.as_str());

        let repo = open_repo(&root)?;
        let target_branch = resolve_target_branch(&repo, Some(branch.to_string()));
        switch_or_prepare_branch(&repo, &target_branch)?;

        let status_before_push = build_git_status(&root);
        if !status_before_push.push_required {
            return Ok(status_before_push);
        }
        if let Some(remote_url) = git_remote_url(&repo) {
            probe_remote_url(&remote_url)?;
        }
        let _ = commit_all_changes(&repo, commit_message, &target_branch)?;
        let ssh_priv = ssh_private_key_if_exists(&self.app);
        let ssh_pub = ssh_public_key_if_exists(&self.app);
        let trusted_host_key = trusted_ssh_host_key_from_settings(&settings);
        remote_push(
            &repo,
            &target_branch,
            username,
            password,
            ssh_priv,
            ssh_pub,
            trusted_host_key,
        )?;
        Ok(build_git_status(&root))
    }
}

fn remote_push(
    repo: &Repository,
    branch: &str,
    username: Option<&str>,
    password: Option<&str>,
    ssh_private_key: Option<PathBuf>,
    ssh_public_key: Option<PathBuf>,
    trusted_host_key: Option<TrustedSshHostKey>,
) -> Result<(), String> {
    let mut callbacks = build_callbacks(
        username,
        password,
        ssh_private_key.clone(),
        ssh_public_key.clone(),
        trusted_host_key.clone(),
    );
    // libgit2's push returns Ok even when the server refuses the ref update
    // (e.g. receive.denyCurrentBranch with a dirty desktop tree) unless the
    // per-ref status is checked here — without this a rejected push looks
    // like a successful sync.
    callbacks.push_update_reference(|refname, status| {
        if let Some(message) = status {
            eprintln!("[git] push rejected for {refname}: {message}");
            return Err(git2::Error::from_str(&format!(
                "The server refused the push ({message}). If the desktop notes changed at the same time, sync once from the desktop and try again."
            )));
        }
        Ok(())
    });
    callbacks.push_transfer_progress(|current, total, bytes| {
        update_transfer_progress(|progress| {
            progress.phase = "pushing".to_string();
            progress.objects_done = current as u32;
            progress.objects_total = total as u32;
            progress.bytes = bytes as u64;
        });
    });
    let mut push_options = PushOptions::new();
    push_options.remote_callbacks(callbacks);
    let mut remote = repo.find_remote("origin").map_err(map_git_error)?;
    eprintln!(
        "[git] pushing '{branch}' to {}",
        redact_remote_url_for_log(remote.url().unwrap_or("<invalid url>"))
    );
    remote
        .connect_auth(
            Direction::Push,
            Some(build_callbacks(
                username,
                password,
                ssh_private_key,
                ssh_public_key,
                trusted_host_key,
            )),
            None,
        )
        .map_err(map_git_error)?;
    update_transfer_progress(|progress| {
        *progress = GitTransferProgress {
            phase: "pushing".to_string(),
            ..GitTransferProgress::default()
        };
    });
    let push_result = remote.push(
        &[&format!("refs/heads/{0}:refs/heads/{0}", branch)],
        Some(&mut push_options),
    );
    reset_transfer_progress();
    push_result.map_err(|error| {
        let message = map_git_error(error);
        eprintln!("[git] push failed: {message}");
        message
    })?;
    eprintln!("[git] push complete");
    let mut local = repo
        .find_branch(branch, git2::BranchType::Local)
        .map_err(map_git_error)?;
    local
        .set_upstream(Some(&format!("origin/{}", branch)))
        .map_err(map_git_error)?;
    Ok(())
}

// ── Core helpers ───────────────────────────────────────────────────────────────

/// Convert a git2 error into a user-facing string.
pub fn map_git_error(error: git2::Error) -> String {
    error.message().to_string()
}

fn redact_remote_url_for_log(remote: &str) -> String {
    let Some(scheme_end) = remote.find("://") else {
        return remote.to_string();
    };
    let scheme = &remote[..scheme_end + 3];
    let rest = &remote[scheme_end + 3..];
    let Some(at) = rest.find('@') else {
        return remote.to_string();
    };
    let userinfo = &rest[..at];
    let host_and_path = &rest[at + 1..];
    let redacted = if scheme.eq_ignore_ascii_case("ssh://")
        && userinfo.to_ascii_lowercase().starts_with("pair-")
    {
        "pair-<token>"
    } else if userinfo.contains(':') {
        "<credentials>"
    } else {
        userinfo
    };
    format!("{scheme}{redacted}@{host_and_path}")
}

fn redact_username_for_log(username: &str) -> String {
    if username.to_ascii_lowercase().starts_with("pair-") {
        "pair-<token>".to_string()
    } else {
        username.to_string()
    }
}

/// Open an existing git repository at the given path.
pub fn open_repo(root: &Path) -> Result<Repository, String> {
    Repository::open(root).map_err(map_git_error)
}

/// Check whether a `.git` directory exists at the given path.
pub fn git_repo_initialized(root: &Path) -> bool {
    Repository::open(root).is_ok()
}

/// Get the name of the current HEAD branch, if any.
pub fn git_current_branch(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if !head.is_branch() {
        return None;
    }
    head.shorthand().map(|value| value.to_string())
}

/// Get the URL of the "origin" remote, if configured.
pub fn git_remote_url(repo: &Repository) -> Option<String> {
    let remote = repo.find_remote("origin").ok()?;
    remote.url().map(|value| value.to_string())
}

/// True if the working tree has uncommitted changes.
pub fn git_has_changes(repo: &Repository) -> bool {
    let mut status_opts = StatusOptions::new();
    status_opts
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true);
    let Ok(statuses) = repo.statuses(Some(&mut status_opts)) else {
        return false;
    };
    let index = repo.index().ok();
    statuses.iter().any(|entry| {
        // libgit2 reports a missing skip-worktree file as WT_DELETED even
        // though native Git correctly treats it as clean. Mobile audio cache
        // eviction relies on that bit, so mirror Git's behavior here and
        // avoid an empty auto-sync commit for every archived recording.
        if entry.status() == git2::Status::WT_DELETED {
            let skipped = entry
                .path()
                .and_then(|path| index.as_ref()?.get_path(Path::new(path), 0))
                .map(|index_entry| {
                    index_entry.flags_extended
                        & git2::IndexEntryExtendedFlag::SKIP_WORKTREE.bits()
                        != 0
                })
                .unwrap_or(false);
            if skipped {
                return false;
            }
        }
        true
    })
}

// ── Timestamp cache ────────────────────────────────────────────────────────────

// ── Bootstrap detection ────────────────────────────────────────────────────────

fn git_head_has_commit(repo: &Repository) -> bool {
    repo.head().ok().and_then(|head| head.target()).is_some()
}

/// Check if a worktree contains only empty system folders and the order file.
fn worktree_has_only_bootstrap_artifacts(root: &Path) -> Result<bool, String> {
    for entry in fs::read_dir(root).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".git" {
            continue;
        }
        let path = entry.path();
        let metadata = entry.metadata().map_err(|err| err.to_string())?;
        if metadata.is_file() {
            if name != ORDER_FILE {
                return Ok(false);
            }
            continue;
        }
        if metadata.is_dir() {
            if !is_system_folder_name(&name) {
                return Ok(false);
            }
            let mut items = fs::read_dir(path).map_err(|err| err.to_string())?;
            if items.next().is_some() {
                return Ok(false);
            }
            continue;
        }
        return Ok(false);
    }
    Ok(true)
}

fn clear_bootstrap_artifacts(root: &Path) -> Result<(), String> {
    let order_path = root.join(ORDER_FILE);
    if order_path.exists() {
        fs::remove_file(&order_path).map_err(|err| err.to_string())?;
    }
    for folder in PROTECTED_SYSTEM_FOLDERS {
        let path = root.join(folder);
        if !path.exists() {
            continue;
        }
        let mut items = fs::read_dir(&path).map_err(|err| err.to_string())?;
        if items.next().is_none() {
            fs::remove_dir(&path).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

/// Prepare a never-synced worktree (unborn HEAD) for its first sync: freshly
/// bootstrapped empty system folders are removed so the remote content wins;
/// real local notes (e.g. captured on the phone before the first pairing) are
/// committed so the first pull merges the two sets instead of refusing to
/// connect — there is nothing a user could "push first" on a device that has
/// never synced.
pub fn prepare_bootstrap_worktree_for_sync(
    root: &Path,
    repo: &Repository,
    branch: &str,
) -> Result<(), String> {
    if git_head_has_commit(repo) || !git_has_changes(repo) {
        return Ok(());
    }
    if worktree_has_only_bootstrap_artifacts(root)? {
        clear_bootstrap_artifacts(root)?;
        return Ok(());
    }
    commit_all_changes(repo, "Notes from this device", branch)?;
    Ok(())
}

// ── Ahead / behind ─────────────────────────────────────────────────────────────

fn git_ahead_behind(repo: &Repository, branch: Option<&str>) -> (usize, usize) {
    let branch_name = match branch {
        Some(value) => value,
        None => return (0, 0),
    };
    let local = match repo.find_branch(branch_name, git2::BranchType::Local) {
        Ok(branch) => branch,
        Err(_) => return (0, 0),
    };
    let upstream = match local.upstream() {
        Ok(branch) => branch,
        Err(_) => return (0, 0),
    };
    let local_oid = match local.get().target() {
        Some(value) => value,
        None => return (0, 0),
    };
    let upstream_oid = match upstream.get().target() {
        Some(value) => value,
        None => return (0, 0),
    };
    repo.graph_ahead_behind(local_oid, upstream_oid)
        .unwrap_or((0, 0))
}

fn git_branch_has_local_commit(repo: &Repository, branch: Option<&str>) -> bool {
    let Some(branch_name) = branch else {
        return false;
    };
    repo.find_branch(branch_name, git2::BranchType::Local)
        .ok()
        .and_then(|branch_ref| branch_ref.get().target())
        .is_some()
}

fn git_branch_has_upstream(repo: &Repository, branch: Option<&str>) -> bool {
    let Some(branch_name) = branch else {
        return false;
    };
    repo.find_branch(branch_name, git2::BranchType::Local)
        .ok()
        .and_then(|branch_ref| branch_ref.upstream().ok())
        .is_some()
}

// ── Status & history ───────────────────────────────────────────────────────────

/// Build a comprehensive git sync status snapshot for the frontend.
pub fn build_git_status(root: &Path) -> GitSyncStatus {
    let repo = Repository::open(root).ok();
    let repo_initialized = repo.is_some();
    let current_branch = repo.as_ref().and_then(git_current_branch);
    let remote_url = repo.as_ref().and_then(git_remote_url);
    let has_uncommitted_changes = repo.as_ref().is_some_and(git_has_changes);
    let (ahead, behind) = repo
        .as_ref()
        .map(|repository| git_ahead_behind(repository, current_branch.as_deref()))
        .unwrap_or((0, 0));
    let push_required = repo
        .as_ref()
        .map(|repository| {
            if has_uncommitted_changes || ahead > 0 {
                return true;
            }
            let branch = current_branch.as_deref();
            let has_local_commit = git_branch_has_local_commit(repository, branch);
            let has_upstream = git_branch_has_upstream(repository, branch);
            has_local_commit && !has_upstream
        })
        .unwrap_or(false);
    GitSyncStatus {
        git_available: true,
        repo_initialized,
        current_branch,
        remote_url,
        has_uncommitted_changes,
        push_required,
        ahead,
        behind,
        notes_root: root.to_string_lossy().to_string(),
    }
}

fn git_upstream_oid(repo: &Repository, branch: Option<&str>) -> Option<Oid> {
    let branch_name = branch?;
    repo.find_branch(branch_name, git2::BranchType::Local)
        .ok()
        .and_then(|local| local.upstream().ok())
        .and_then(|upstream| upstream.get().target())
}

/// Build the commit history list with sync state indicators.
pub fn build_git_history(root: &Path, limit: usize) -> Result<Vec<GitCommitHistoryEntry>, String> {
    if !git_repo_initialized(root) {
        return Ok(Vec::new());
    }
    let repo = open_repo(root)?;
    let head_oid = match repo.head().ok().and_then(|head| head.target()) {
        Some(oid) => oid,
        None => return Ok(Vec::new()),
    };
    let branch = git_current_branch(&repo);
    let upstream_oid = git_upstream_oid(&repo, branch.as_deref());

    let mut revwalk = repo.revwalk().map_err(map_git_error)?;
    revwalk
        .set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .map_err(map_git_error)?;
    revwalk.push(head_oid).map_err(map_git_error)?;

    let mut entries = Vec::new();
    let max_items = limit.clamp(1, 200);
    for oid_result in revwalk.take(max_items) {
        let oid = oid_result.map_err(map_git_error)?;
        let commit = repo.find_commit(oid).map_err(map_git_error)?;
        let summary = commit
            .summary()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("No commit message")
            .to_string();
        let author_signature = commit.author();
        let author = author_signature
            .name()
            .or_else(|| author_signature.email())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Unknown author")
            .to_string();
        let authored_ms = commit.time().seconds().checked_mul(1_000);
        let sync_state = if let Some(upstream) = upstream_oid {
            if oid == upstream || repo.graph_descendant_of(upstream, oid).unwrap_or(false) {
                "synced"
            } else {
                "local"
            }
        } else {
            "local"
        };
        let id = oid.to_string();
        let short_id = id.chars().take(8).collect::<String>();
        entries.push(GitCommitHistoryEntry {
            id,
            short_id,
            summary,
            author,
            authored_ms,
            sync_state: sync_state.to_string(),
            is_head: oid == head_oid,
        });
    }
    Ok(entries)
}

// ── Repo setup ─────────────────────────────────────────────────────────────────

/// Open an existing repo or initialize a new one. Also makes sure the
/// device-local sync settings never enter the synced history.
pub fn ensure_git_repo(root: &Path) -> Result<Repository, String> {
    let repo = match Repository::open(root) {
        Ok(repo) => repo,
        Err(_) => Repository::init(root).map_err(map_git_error)?,
    };
    ensure_device_settings_excluded(&repo);
    Ok(repo)
}

/// Append device-only metadata to `.git/info/exclude` (repo-local, not synced)
/// so credentials, pinned host keys, and cache state stay off the remote.
/// Best-effort: sync must not fail over an exclude file.
pub(crate) fn ensure_device_settings_excluded(repo: &Repository) {
    let patterns = [
        crate::DEVICE_SETTINGS_EXCLUDE_PATTERN,
        crate::AUDIO_CACHE_EXCLUDE_PATTERN,
    ];
    let exclude_path = repo.path().join("info").join("exclude");
    let existing = fs::read_to_string(&exclude_path).unwrap_or_default();
    let missing = patterns
        .into_iter()
        .filter(|pattern| !existing.lines().any(|line| line.trim() == *pattern))
        .collect::<Vec<_>>();
    if missing.is_empty() {
        return;
    }
    if let Some(parent) = exclude_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let newline = if existing.is_empty() || existing.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    let additions = missing.join("\n");
    let _ = fs::write(&exclude_path, format!("{existing}{newline}{additions}\n"));
}

/// Resolve the target branch name: use provided value, current HEAD, or "main".
pub fn resolve_target_branch(repo: &Repository, branch: Option<String>) -> String {
    let requested = branch
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    if let Some(value) = requested {
        return value;
    }
    git_current_branch(repo).unwrap_or_else(|| "main".to_string())
}

/// Build git2 callbacks with optional credentials.
///
/// When `ssh_private_key` is provided the callback will try key-file auth
/// before falling back to the SSH agent.
pub fn build_callbacks(
    username: Option<&str>,
    password: Option<&str>,
    ssh_private_key: Option<PathBuf>,
    ssh_public_key: Option<PathBuf>,
    trusted_host_key: Option<TrustedSshHostKey>,
) -> RemoteCallbacks<'static> {
    let user = username.map(str::to_string);
    let pass = password.map(str::to_string);
    let mut callbacks = RemoteCallbacks::new();
    let trusted = trusted_host_key.clone();
    callbacks.certificate_check(move |cert, hostname| {
        // No pin that applies to this host: trust local-network hosts on first
        // use (manual setup has no fingerprint to pin, and phones carry no
        // known_hosts, so passthrough would reject every LAN server); anything
        // else keeps libgit2's default known-hosts behavior.
        let applicable = trusted
            .as_ref()
            .filter(|pinned| ssh_host_matches(hostname, &pinned.host));
        let Some(trusted) = applicable else {
            if is_local_hostname(hostname) {
                return Ok(CertificateCheckStatus::CertificateOk);
            }
            return Ok(CertificateCheckStatus::CertificatePassthrough);
        };
        let Some(host_key) = cert.as_hostkey() else {
            return Err(git2::Error::from_str(
                "The local sync server did not present an SSH host key.",
            ));
        };
        let Some(hash) = host_key.hash_sha256() else {
            return Err(git2::Error::from_str(
                "The local sync server host key could not be verified.",
            ));
        };
        let actual = format!("SHA256:{}", STANDARD_NO_PAD.encode(hash));
        if normalize_ssh_fingerprint(&actual) == normalize_ssh_fingerprint(&trusted.sha256) {
            Ok(CertificateCheckStatus::CertificateOk)
        } else {
            Err(git2::Error::from_str(
                "The local sync server host key changed. Stop the desktop server, restart it, and scan the new QR code before syncing.",
            ))
        }
    });
    // libgit2 calls the credentials callback again every time the server
    // rejects the offered credential, so each invocation must offer the *next*
    // candidate — returning the same key forever turns a rejected pairing into
    // an infinite auth loop with a permanently spinning UI.
    //
    // The candidates already offered are tracked by identity (bitmask), not by
    // a positional attempt counter: `allowed` changes between invocations (the
    // URL-has-no-username flow starts with a USERNAME-only round), and counting
    // positions against a shifting set skipped the key file entirely, breaking
    // every ssh:// remote written without a username.
    const TRIED_KEY_FILE: u8 = 1 << 0;
    const TRIED_AGENT: u8 = 1 << 1;
    const TRIED_USERPASS: u8 = 1 << 2;
    const TRIED_DEFAULT: u8 = 1 << 3;
    let tried = std::cell::Cell::new(0u8);
    callbacks.credentials(move |_url, username_from_url, allowed| {
        let ssh_user = username_from_url.or(user.as_deref()).unwrap_or("git");
        // A plain username query (URL without a username) is a session hint,
        // not an authentication attempt — answer it without consuming one.
        if allowed.contains(CredentialType::USERNAME) {
            eprintln!(
                "[git] auth: answering username query with '{}'",
                redact_username_for_log(ssh_user)
            );
            return Cred::username(ssh_user);
        }
        let mark = |bit: u8| -> bool {
            let already = tried.get();
            if already & bit != 0 {
                return false;
            }
            tried.set(already | bit);
            true
        };
        if allowed.contains(CredentialType::SSH_KEY) {
            if ssh_private_key.is_some() && mark(TRIED_KEY_FILE) {
                let private_key = ssh_private_key.as_ref().unwrap();
                eprintln!(
                    "[git] auth: offering ssh key file as '{}'",
                    redact_username_for_log(ssh_user)
                );
                match Cred::ssh_key(ssh_user, ssh_public_key.as_deref(), private_key, None) {
                    Ok(cred) => return Ok(cred),
                    Err(error) => {
                        // Unreadable key file: fall through to the next candidate.
                        eprintln!("[git] auth: could not load ssh key file: {error}");
                    }
                }
            }
            if mark(TRIED_AGENT) {
                eprintln!(
                    "[git] auth: offering ssh agent as '{}'",
                    redact_username_for_log(ssh_user)
                );
                if let Ok(cred) = Cred::ssh_key_from_agent(ssh_user) {
                    return Ok(cred);
                }
            }
        }
        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
            if let (Some(user), Some(pass)) = (user.as_deref(), pass.as_deref()) {
                if mark(TRIED_USERPASS) {
                    eprintln!(
                        "[git] auth: offering username/password as '{}'",
                        redact_username_for_log(user)
                    );
                    return Cred::userpass_plaintext(user, pass);
                }
            }
        }
        if allowed.contains(CredentialType::DEFAULT) && mark(TRIED_DEFAULT) {
            eprintln!("[git] auth: offering default credentials");
            return Cred::default();
        }
        if tried.get() == 0 {
            eprintln!("[git] auth failed: no usable credentials for this remote");
            return Err(git2::Error::from_str(
                "No matching Git credentials available for this remote.",
            ));
        }
        eprintln!("[git] auth failed: server rejected every offered credential");
        Err(git2::Error::from_str(
            "The server rejected this device's key. For local sync this means the phone is not paired (or the pairing code expired) — scan the QR code in desktop Settings → Sync again.",
        ))
    });
    callbacks
}

/// Create or update the "origin" remote to point at the given URL.
pub fn ensure_origin_remote(repo: &Repository, remote_url: &str) -> Result<(), String> {
    let url = remote_url.trim();
    if url.is_empty() {
        return Err("Remote repository URL is required.".to_string());
    }
    match repo.find_remote("origin") {
        Ok(_) => repo.remote_set_url("origin", url).map_err(map_git_error)?,
        Err(_) => {
            repo.remote("origin", url).map_err(map_git_error)?;
        }
    }
    Ok(())
}

/// Switch to the target branch, creating it if it doesn't exist.
pub fn switch_or_prepare_branch(repo: &Repository, branch: &str) -> Result<(), String> {
    let name = branch.trim();
    if name.is_empty() {
        return Ok(());
    }
    let local_ref = format!("refs/heads/{}", name);
    if repo.find_reference(&local_ref).is_ok() {
        repo.set_head(&local_ref).map_err(map_git_error)?;
        repo.checkout_head(Some(CheckoutBuilder::new().safe()))
            .map_err(map_git_error)?;
        return Ok(());
    }
    if let Ok(head) = repo.head() {
        if let Some(head_oid) = head.target() {
            let commit = repo.find_commit(head_oid).map_err(map_git_error)?;
            repo.branch(name, &commit, false).map_err(map_git_error)?;
            repo.set_head(&local_ref).map_err(map_git_error)?;
            repo.checkout_head(Some(CheckoutBuilder::new().safe()))
                .map_err(map_git_error)?;
            return Ok(());
        }
    }
    repo.set_head(&local_ref).map_err(map_git_error)
}

fn default_signature(repo: &Repository) -> Result<Signature<'_>, String> {
    if let Ok(sig) = repo.signature() {
        return Ok(sig);
    }
    Signature::now("Type Notes Sync", "sync@local").map_err(map_git_error)
}

/// Stage all changes and create a commit on the given branch.
pub fn commit_all_changes(
    repo: &Repository,
    message: &str,
    branch: &str,
) -> Result<Option<Oid>, String> {
    let mut index = repo.index().map_err(map_git_error)?;
    index
        .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .map_err(map_git_error)?;
    index.write().map_err(map_git_error)?;
    if index.is_empty() && !git_has_changes(repo) {
        return Ok(None);
    }
    let tree_id = index.write_tree().map_err(map_git_error)?;
    let tree = repo.find_tree(tree_id).map_err(map_git_error)?;
    let sig = default_signature(repo)?;
    let update_ref = format!("refs/heads/{}", branch);
    let oid = match repo.head() {
        Ok(head) => {
            if let Some(head_oid) = head.target() {
                let parent = repo.find_commit(head_oid).map_err(map_git_error)?;
                repo.commit(Some(&update_ref), &sig, &sig, message, &tree, &[&parent])
                    .map_err(map_git_error)?
            } else {
                repo.commit(Some(&update_ref), &sig, &sig, message, &tree, &[])
                    .map_err(map_git_error)?
            }
        }
        Err(_) => repo
            .commit(Some(&update_ref), &sig, &sig, message, &tree, &[])
            .map_err(map_git_error)?,
    };
    repo.set_head(&update_ref).map_err(map_git_error)?;
    Ok(Some(oid))
}

fn trusted_ssh_host_key_from_settings(
    settings: &crate::ProfileSettings,
) -> Option<TrustedSshHostKey> {
    let host = settings.git_trusted_ssh_host.trim();
    let sha256 = settings.git_trusted_ssh_host_key_sha256.trim();
    if host.is_empty() || sha256.is_empty() {
        return None;
    }
    Some(TrustedSshHostKey {
        host: host.to_string(),
        sha256: sha256.to_string(),
    })
}

fn normalize_ssh_fingerprint(value: &str) -> String {
    value
        .trim()
        .strip_prefix("SHA256:")
        .unwrap_or(value.trim())
        .trim_end_matches('=')
        .to_string()
}

fn ssh_host_matches(actual: &str, expected: &str) -> bool {
    normalize_host_for_compare(actual) == normalize_host_for_compare(expected)
}

fn normalize_host_for_compare(value: &str) -> String {
    let trimmed = value.trim().trim_start_matches('[').trim_end_matches(']');
    if let Some((host, port)) = trimmed.rsplit_once(':') {
        if port.chars().all(|c| c.is_ascii_digit()) && !host.contains(':') {
            return host
                .trim_start_matches('[')
                .trim_end_matches(']')
                .to_ascii_lowercase();
        }
    }
    trimmed.to_ascii_lowercase()
}

fn probe_remote_url(remote_url: &str) -> Result<(), String> {
    let Some(target) = tcp_target_from_remote(remote_url) else {
        return Ok(());
    };
    // A LAN git:// remote is a leftover from the pre-SSH local sync server;
    // the port now answers SSH, so the git protocol would fail confusingly.
    if remote_url.trim().to_ascii_lowercase().starts_with("git://") && is_lan_host(&target.host) {
        return Err(
            "This connection uses the old git:// local sync. The desktop now shares notes over SSH — scan the new QR code in desktop Settings → Sync.".to_string(),
        );
    }
    let addrs = target
        .to_socket_addrs()
        .map_err(|error| network_probe_error(&target.host, target.port, Some(error)))?;
    let timeout = Duration::from_secs(4);
    let mut last_error = None;
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, timeout) {
            Ok(_) => {
                eprintln!("[git] probe {}:{} ok", target.host, target.port);
                return Ok(());
            }
            Err(error) => last_error = Some(error),
        }
    }
    let message = network_probe_error(&target.host, target.port, last_error);
    eprintln!(
        "[git] probe {}:{} failed: {message}",
        target.host, target.port
    );
    Err(message)
}

struct TcpTarget {
    host: String,
    port: u16,
}

impl ToSocketAddrs for TcpTarget {
    type Iter = std::vec::IntoIter<std::net::SocketAddr>;

    fn to_socket_addrs(&self) -> std::io::Result<Self::Iter> {
        (self.host.as_str(), self.port)
            .to_socket_addrs()
            .map(|iter| iter.collect::<Vec<_>>().into_iter())
    }
}

fn tcp_target_from_remote(remote_url: &str) -> Option<TcpTarget> {
    let value = remote_url.trim();
    if value.is_empty() || value.starts_with('/') || value.starts_with("file://") {
        return None;
    }
    let lower = value.to_ascii_lowercase();
    for (scheme, default_port) in [
        ("ssh://", 22),
        ("git://", 9418),
        ("https://", 443),
        ("http://", 80),
    ] {
        if lower.starts_with(scheme) {
            return tcp_target_from_url_authority(&value[scheme.len()..], default_port);
        }
    }
    tcp_target_from_scp_like(value)
}

fn tcp_target_from_url_authority(rest: &str, default_port: u16) -> Option<TcpTarget> {
    let authority = rest
        .split('/')
        .next()?
        .split('?')
        .next()?
        .split('#')
        .next()?;
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    parse_host_port(host_port, default_port)
}

fn tcp_target_from_scp_like(value: &str) -> Option<TcpTarget> {
    if value.contains("://") {
        return None;
    }
    let bytes = value.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return None;
    }
    let before_colon = value.split(':').next()?;
    if before_colon.contains('/') {
        return None;
    }
    let host = before_colon
        .rsplit('@')
        .next()
        .unwrap_or(before_colon)
        .trim();
    if host.is_empty() {
        None
    } else {
        Some(TcpTarget {
            host: host.to_string(),
            port: 22,
        })
    }
}

fn parse_host_port(value: &str, default_port: u16) -> Option<TcpTarget> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(end) = trimmed
        .strip_prefix('[')
        .and_then(|v| v.find(']').map(|idx| idx + 1))
    {
        let host = &trimmed[1..end];
        let port = trimmed
            .get(end + 1..)
            .and_then(|suffix| suffix.strip_prefix(':'))
            .and_then(|port| port.parse().ok())
            .unwrap_or(default_port);
        return Some(TcpTarget {
            host: host.to_string(),
            port,
        });
    }
    if let Some((host, port)) = trimmed.rsplit_once(':') {
        if !host.contains(':') {
            return Some(TcpTarget {
                host: host.to_string(),
                port: port.parse().unwrap_or(default_port),
            });
        }
    }
    Some(TcpTarget {
        host: trimmed.to_string(),
        port: default_port,
    })
}

fn network_probe_error(host: &str, port: u16, error: Option<std::io::Error>) -> String {
    let local_hint = if is_lan_host(host) || host.ends_with(".local") {
        " Check that the desktop sync server is running, both devices are on the same Wi-Fi or hotspot, and Local Network access is allowed in iOS Settings."
    } else {
        " Check the network connection, remote URL, and credentials."
    };
    match error {
        Some(error) if error.kind() == std::io::ErrorKind::TimedOut => {
            format!("Connection to {host}:{port} timed out after 4 seconds.{local_hint}")
        }
        Some(error) if error.kind() == std::io::ErrorKind::ConnectionRefused => {
            format!("No sync server answered at {host}:{port} (connection refused).{local_hint}")
        }
        Some(error) => format!("Remote {host}:{port} is unreachable: {error}.{local_hint}"),
        None => format!("Remote {host}:{port} is unreachable.{local_hint}"),
    }
}

fn is_lan_host(host: &str) -> bool {
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip.is_private() || ip.is_link_local() || ip.is_loopback(),
        Ok(IpAddr::V6(ip)) => ip.is_loopback() || ip.is_unicast_link_local(),
        Err(_) => false,
    }
}

/// Like [`is_lan_host`] but tolerant of the `[host]:port` forms libgit2 hands
/// to the certificate callback, and counting mDNS `.local` names as local.
fn is_local_hostname(hostname: &str) -> bool {
    let normalized = normalize_host_for_compare(hostname);
    is_lan_host(&normalized) || normalized.ends_with(".local")
}

// ── Transfer progress ──────────────────────────────────────────────────────────

/// Live progress of the current fetch/push, published for UI polling (the
/// same snapshot-poll pattern the Apple Notes importer uses — no events).
#[derive(Serialize, Clone, Default)]
pub struct GitTransferProgress {
    /// "idle" | "receiving" | "indexing" | "pushing"
    pub phase: String,
    pub objects_done: u32,
    pub objects_total: u32,
    pub bytes: u64,
    /// Latest textual progress line reported by the remote, if any.
    pub remote_text: String,
}

static TRANSFER_PROGRESS: std::sync::Mutex<Option<GitTransferProgress>> =
    std::sync::Mutex::new(None);

/// Current transfer progress; `phase == "idle"` when nothing is in flight.
pub fn git_transfer_progress_snapshot() -> GitTransferProgress {
    TRANSFER_PROGRESS
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .unwrap_or_else(|| GitTransferProgress {
            phase: "idle".to_string(),
            ..GitTransferProgress::default()
        })
}

fn update_transfer_progress(update: impl FnOnce(&mut GitTransferProgress)) {
    if let Ok(mut guard) = TRANSFER_PROGRESS.lock() {
        let mut progress = guard.take().unwrap_or_default();
        update(&mut progress);
        *guard = Some(progress);
    }
}

fn reset_transfer_progress() {
    if let Ok(mut guard) = TRANSFER_PROGRESS.lock() {
        *guard = Some(GitTransferProgress {
            phase: "idle".to_string(),
            ..GitTransferProgress::default()
        });
    }
}

// ── Fetch / merge ──────────────────────────────────────────────────────────────

/// Fetch from "origin" and return the annotated commit for the target branch.
pub fn perform_fetch<'a>(
    repo: &'a Repository,
    branch: &str,
    username: Option<&str>,
    password: Option<&str>,
    ssh_private_key: Option<PathBuf>,
    ssh_public_key: Option<PathBuf>,
    trusted_host_key: Option<TrustedSshHostKey>,
) -> Result<AnnotatedCommit<'a>, String> {
    let mut remote = repo.find_remote("origin").map_err(map_git_error)?;
    eprintln!(
        "[git] fetching '{branch}' from {}",
        redact_remote_url_for_log(remote.url().unwrap_or("<invalid url>"))
    );
    let mut callbacks = build_callbacks(
        username,
        password,
        ssh_private_key,
        ssh_public_key,
        trusted_host_key,
    );
    callbacks.transfer_progress(|stats| {
        let receiving = stats.received_objects() < stats.total_objects();
        update_transfer_progress(|progress| {
            progress.phase = if receiving { "receiving" } else { "indexing" }.to_string();
            progress.objects_done = if receiving {
                stats.received_objects()
            } else {
                stats.indexed_objects()
            } as u32;
            progress.objects_total = stats.total_objects() as u32;
            progress.bytes = stats.received_bytes() as u64;
        });
        true
    });
    callbacks.sideband_progress(|line| {
        let text = String::from_utf8_lossy(line).trim().to_string();
        if !text.is_empty() {
            update_transfer_progress(|progress| progress.remote_text = text);
        }
        true
    });
    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);
    update_transfer_progress(|progress| {
        *progress = GitTransferProgress {
            phase: "receiving".to_string(),
            ..GitTransferProgress::default()
        };
    });
    let fetch_result = remote.fetch(&[branch], Some(&mut fetch_options), None);
    reset_transfer_progress();
    fetch_result.map_err(|error| {
        let message = map_git_error(error);
        eprintln!("[git] fetch failed: {message}");
        message
    })?;
    eprintln!("[git] fetch complete");
    let fetch_head = repo.find_reference("FETCH_HEAD").map_err(map_git_error)?;
    repo.reference_to_annotated_commit(&fetch_head)
        .map_err(map_git_error)
}

/// Fast-forward the local branch to match the fetched commit.
pub fn fast_forward_to(
    repo: &Repository,
    branch: &str,
    fetch_commit: &AnnotatedCommit<'_>,
) -> Result<(), String> {
    let target_oid = fetch_commit.id();
    let local_ref_name = format!("refs/heads/{}", branch);
    match repo.find_reference(&local_ref_name) {
        Ok(mut local_ref) => {
            local_ref
                .set_target(target_oid, "Fast-forward")
                .map_err(map_git_error)?;
            repo.set_head(&local_ref_name).map_err(map_git_error)?;
            repo.checkout_head(Some(CheckoutBuilder::new().safe()))
                .map_err(map_git_error)?;
        }
        Err(_) => {
            let commit = repo.find_commit(target_oid).map_err(map_git_error)?;
            repo.branch(branch, &commit, false).map_err(map_git_error)?;
            repo.set_head(&local_ref_name).map_err(map_git_error)?;
            repo.checkout_head(Some(CheckoutBuilder::new().safe()))
                .map_err(map_git_error)?;
        }
    }
    Ok(())
}

/// Build a `.conflict` sibling path: `dir/note.md` → `dir/note.conflict.md`.
fn make_conflict_path(rel_path: &str) -> String {
    let p = Path::new(rel_path);
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy())
        .unwrap_or_default();
    let new_name = match p.extension().map(|s| s.to_string_lossy()) {
        Some(ext) => format!("{stem}.conflict.{ext}"),
        None => format!("{stem}.conflict"),
    };
    p.with_file_name(new_name).to_string_lossy().to_string()
}

/// Merge a fetched commit, saving `.conflict` files when there are conflicts.
pub fn merge_fetched_commit(
    repo: &Repository,
    branch: &str,
    fetched_commit: &AnnotatedCommit<'_>,
) -> Result<(), String> {
    let pre_merge_head = repo
        .head()
        .map_err(map_git_error)?
        .peel_to_commit()
        .map_err(map_git_error)?;

    let mut checkout_options = CheckoutBuilder::new();
    checkout_options.safe();
    repo.merge(&[fetched_commit], None, Some(&mut checkout_options))
        .map_err(map_git_error)?;

    let merge_result = (|| -> Result<(), String> {
        let head_commit = repo
            .head()
            .map_err(map_git_error)?
            .peel_to_commit()
            .map_err(map_git_error)?;
        let remote_commit = repo
            .find_commit(fetched_commit.id())
            .map_err(map_git_error)?;
        let mut index = repo.index().map_err(map_git_error)?;

        if index.has_conflicts() {
            let workdir = repo
                .workdir()
                .ok_or_else(|| "Repository has no working directory.".to_string())?;

            // Collect conflict entries first (can't mutate index while iterating).
            let conflict_entries: Vec<_> = index
                .conflicts()
                .map_err(map_git_error)?
                .filter_map(|r| r.ok())
                .collect();

            let mut resolved_paths = Vec::new();

            for entry in &conflict_entries {
                let rel_path = entry
                    .our
                    .as_ref()
                    .or(entry.their.as_ref())
                    .or(entry.ancestor.as_ref())
                    .and_then(|e| std::str::from_utf8(&e.path).ok())
                    .map(|s| s.to_string());
                let Some(rel_path) = rel_path else {
                    continue;
                };

                match (&entry.our, &entry.their) {
                    (Some(ours), Some(theirs)) => {
                        // Both sides modified — keep ours, save theirs as .conflict.
                        let their_blob = repo.find_blob(theirs.id).map_err(map_git_error)?;
                        let conflict_rel = make_conflict_path(&rel_path);
                        let conflict_abs = workdir.join(&conflict_rel);
                        if let Some(parent) = conflict_abs.parent() {
                            let _ = fs::create_dir_all(parent);
                        }
                        fs::write(&conflict_abs, their_blob.content())
                            .map_err(|e| e.to_string())?;

                        let our_blob = repo.find_blob(ours.id).map_err(map_git_error)?;
                        fs::write(workdir.join(&rel_path), our_blob.content())
                            .map_err(|e| e.to_string())?;
                    }
                    (Some(ours), None) => {
                        // They deleted, we modified — keep ours.
                        let our_blob = repo.find_blob(ours.id).map_err(map_git_error)?;
                        fs::write(workdir.join(&rel_path), our_blob.content())
                            .map_err(|e| e.to_string())?;
                    }
                    (None, Some(theirs)) => {
                        // We deleted, they modified — take theirs.
                        let their_blob = repo.find_blob(theirs.id).map_err(map_git_error)?;
                        let full_path = workdir.join(&rel_path);
                        if let Some(parent) = full_path.parent() {
                            let _ = fs::create_dir_all(parent);
                        }
                        fs::write(&full_path, their_blob.content()).map_err(|e| e.to_string())?;
                    }
                    (None, None) => continue,
                }

                resolved_paths.push(rel_path);
            }

            // Resolve each conflict in the index and stage files.
            for rel_path in &resolved_paths {
                index
                    .conflict_remove(Path::new(rel_path))
                    .map_err(map_git_error)?;
                if workdir.join(rel_path).exists() {
                    index.add_path(Path::new(rel_path)).map_err(map_git_error)?;
                }
                let conflict_rel = make_conflict_path(rel_path);
                if workdir.join(&conflict_rel).exists() {
                    index
                        .add_path(Path::new(&conflict_rel))
                        .map_err(map_git_error)?;
                }
            }

            index.write().map_err(map_git_error)?;

            if !resolved_paths.is_empty() {
                println!(
                    "[git] Resolved {} conflict(s) with .conflict files: {}",
                    resolved_paths.len(),
                    resolved_paths.join(", ")
                );
            }
        }

        let tree_id = index.write_tree_to(repo).map_err(map_git_error)?;
        let tree = repo.find_tree(tree_id).map_err(map_git_error)?;
        let signature = default_signature(repo)?;
        let message = format!("Merge origin/{branch} into {branch}");
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &message,
            &tree,
            &[&head_commit, &remote_commit],
        )
        .map_err(map_git_error)?;
        repo.checkout_head(Some(CheckoutBuilder::new().safe()))
            .map_err(map_git_error)?;
        Ok(())
    })();

    match merge_result {
        Ok(()) => {
            repo.cleanup_state().map_err(map_git_error)?;
            Ok(())
        }
        Err(error_message) => {
            let cleanup_error = repo.cleanup_state().map_err(map_git_error).err();
            let reset_error = repo
                .reset(pre_merge_head.as_object(), ResetType::Hard, None)
                .map_err(map_git_error)
                .err();
            if cleanup_error.is_none() && reset_error.is_none() {
                return Err(error_message);
            }
            let mut extras = Vec::new();
            if let Some(value) = cleanup_error {
                extras.push(format!("cleanup_state failed: {value}"));
            }
            if let Some(value) = reset_error {
                extras.push(format!("reset failed: {value}"));
            }
            Err(format!(
                "{error_message} Automatic rollback failed: {}",
                extras.join("; ")
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(remote: &str) -> Option<(String, u16)> {
        tcp_target_from_remote(remote).map(|value| (value.host, value.port))
    }

    #[test]
    fn parses_network_remotes_for_probe() {
        assert_eq!(
            target("ssh://pair-token@192.168.1.10:9418/Notes"),
            Some(("192.168.1.10".to_string(), 9418))
        );
        assert_eq!(
            target("git://10.0.0.2/Notes"),
            Some(("10.0.0.2".to_string(), 9418))
        );
        assert_eq!(
            target("https://github.com/acme/notes.git"),
            Some(("github.com".to_string(), 443))
        );
        assert_eq!(
            target("git@github.com:acme/notes.git"),
            Some(("github.com".to_string(), 22))
        );
    }

    #[test]
    fn skips_local_file_remotes_for_probe() {
        assert_eq!(target("/Users/me/notes"), None);
        assert_eq!(target("file:///Users/me/notes"), None);
        assert_eq!(target(r"C:\Users\me\notes"), None);
    }

    #[test]
    fn lan_git_remotes_are_rejected_with_guidance() {
        let error = probe_remote_url("git://192.168.1.10/notes").unwrap_err();
        assert!(error.contains("scan the new QR code"), "got: {error}");
    }

    #[test]
    fn local_hostnames_are_detected() {
        assert!(is_local_hostname("192.168.1.10"));
        assert!(is_local_hostname("[10.0.0.2]:9418"));
        assert!(is_local_hostname("mac-mini.local"));
        assert!(!is_local_hostname("github.com"));
        assert!(!is_local_hostname("8.8.8.8"));
    }

    #[test]
    fn redacts_pairing_tokens_and_credentials_in_git_logs() {
        assert_eq!(
            redact_remote_url_for_log("ssh://pair-deadbeef@192.168.1.10:9418/Notes"),
            "ssh://pair-<token>@192.168.1.10:9418/Notes"
        );
        assert_eq!(
            redact_remote_url_for_log("https://user:secret@example.com/notes.git"),
            "https://<credentials>@example.com/notes.git"
        );
        assert_eq!(
            redact_remote_url_for_log("ssh://git@github.com/acme/notes.git"),
            "ssh://git@github.com/acme/notes.git"
        );
        assert_eq!(redact_username_for_log("pair-deadbeef"), "pair-<token>");
    }

    /// The first-pairing scenario: the phone already holds captured notes
    /// (unborn HEAD + real files) and the desktop repo has its own history.
    /// Connect must commit the phone notes instead of refusing, and the first
    /// pull must merge the two unrelated histories into a union of notes.
    #[test]
    fn first_sync_merges_phone_notes_with_desktop_notes() {
        let base = std::env::temp_dir().join(format!("type-first-sync-{}", uuid::Uuid::now_v7()));

        let desktop = base.join("desktop");
        fs::create_dir_all(desktop.join("Feed")).unwrap();
        fs::write(desktop.join("Feed").join("desktop-note.md"), "desktop\n").unwrap();
        let desktop_repo = ensure_git_repo(&desktop).unwrap();
        commit_all_changes(&desktop_repo, "init", "main").unwrap();

        let phone = base.join("phone");
        fs::create_dir_all(phone.join("Feed")).unwrap();
        fs::create_dir_all(phone.join("Archieve")).unwrap();
        fs::write(phone.join("Feed").join("phone-note.md"), "phone\n").unwrap();
        let phone_repo = ensure_git_repo(&phone).unwrap();

        prepare_bootstrap_worktree_for_sync(&phone, &phone_repo, "main").unwrap();
        assert!(
            git_head_has_commit(&phone_repo),
            "existing notes should be committed, not rejected"
        );

        ensure_origin_remote(&phone_repo, desktop.to_str().unwrap()).unwrap();
        switch_or_prepare_branch(&phone_repo, "main").unwrap();
        let fetched = perform_fetch(&phone_repo, "main", None, None, None, None, None).unwrap();
        let analysis = phone_repo.merge_analysis(&[&fetched]).unwrap().0;
        assert!(
            analysis.is_normal(),
            "unrelated histories should need a merge"
        );
        merge_fetched_commit(&phone_repo, "main", &fetched).unwrap();

        assert!(phone.join("Feed").join("phone-note.md").exists());
        assert!(
            phone.join("Feed").join("desktop-note.md").exists(),
            "first pull should bring the desktop notes in"
        );

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn ensure_git_repo_excludes_device_settings_once() {
        let root = std::env::temp_dir().join(format!("type-git-exclude-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();

        let _ = ensure_git_repo(&root).unwrap();
        let _ = ensure_git_repo(&root).unwrap(); // idempotent
        let exclude = fs::read_to_string(root.join(".git").join("info").join("exclude")).unwrap();
        let hits = exclude
            .lines()
            .filter(|line| line.trim() == crate::DEVICE_SETTINGS_EXCLUDE_PATTERN)
            .count();
        assert_eq!(hits, 1);

        fs::remove_dir_all(&root).unwrap();
    }
}
