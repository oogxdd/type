//! Git operations: repo init, fetch, push, merge, status, history.

use git2::{
    build::CheckoutBuilder, AnnotatedCommit, Cred, CredentialType, FetchOptions, IndexAddOption,
    Oid, RemoteCallbacks, Repository, ResetType, Signature, Sort, StatusOptions,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
};

use crate::{app_data_dir, is_system_folder_name, ORDER_FILE, PROTECTED_SYSTEM_FOLDERS};

// ── SSH key management ────────────────────────────────────────────────────────

const SSH_DIR_NAME: &str = "ssh";
const SSH_PRIVATE_KEY_NAME: &str = "id_ed25519";
const SSH_PUBLIC_KEY_NAME: &str = "id_ed25519.pub";

fn ssh_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(SSH_DIR_NAME))
}

fn ssh_private_key_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ssh_dir(app)?.join(SSH_PRIVATE_KEY_NAME))
}

fn ssh_public_key_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ssh_dir(app)?.join(SSH_PUBLIC_KEY_NAME))
}

/// Generate an Ed25519 SSH keypair using ssh-keygen.
pub(crate) fn generate_ssh_keypair(app: &tauri::AppHandle) -> Result<String, String> {
    let dir = ssh_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let private_path = dir.join(SSH_PRIVATE_KEY_NAME);
    if private_path.exists() {
        return Err("SSH key already exists. Delete it first to regenerate.".to_string());
    }
    let output = Command::new("ssh-keygen")
        .args([
            "-t",
            "ed25519",
            "-f",
            &private_path.to_string_lossy(),
            "-N",
            "",
            "-C",
            "type-notes-sync",
        ])
        .output()
        .map_err(|e| format!("Failed to run ssh-keygen: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ssh-keygen failed: {stderr}"));
    }
    // Set restrictive permissions on the private key.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        fs::set_permissions(&private_path, perms).map_err(|e| e.to_string())?;
    }
    let public = fs::read_to_string(dir.join(SSH_PUBLIC_KEY_NAME)).map_err(|e| e.to_string())?;
    Ok(public.trim().to_string())
}

/// Read the public key, if it exists.
pub(crate) fn read_ssh_public_key(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let path = ssh_public_key_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(content.trim().to_string()))
}

/// Delete the SSH keypair.
pub(crate) fn delete_ssh_keypair(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = ssh_dir(app)?;
    let private = dir.join(SSH_PRIVATE_KEY_NAME);
    let public = dir.join(SSH_PUBLIC_KEY_NAME);
    if private.exists() {
        fs::remove_file(&private).map_err(|e| e.to_string())?;
    }
    if public.exists() {
        fs::remove_file(&public).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Return the private key path if it exists, for use in credentials callbacks.
pub(crate) fn ssh_private_key_if_exists(app: &tauri::AppHandle) -> Option<PathBuf> {
    ssh_private_key_path(app).ok().filter(|p| p.exists())
}

/// Return the public key path if it exists, for use in credentials callbacks.
pub(crate) fn ssh_public_key_if_exists(app: &tauri::AppHandle) -> Option<PathBuf> {
    ssh_public_key_path(app).ok().filter(|p| p.exists())
}

// ── Types ──────────────────────────────────────────────────────────────────────

/// Git sync status snapshot returned to the frontend.
#[derive(Serialize)]
pub(crate) struct GitSyncStatus {
    pub(crate) git_available: bool,
    pub(crate) repo_initialized: bool,
    pub(crate) current_branch: Option<String>,
    pub(crate) remote_url: Option<String>,
    pub(crate) has_uncommitted_changes: bool,
    pub(crate) push_required: bool,
    pub(crate) ahead: usize,
    pub(crate) behind: usize,
    pub(crate) notes_root: String,
}

/// Single commit entry in the git history list.
#[derive(Serialize)]
pub(crate) struct GitCommitHistoryEntry {
    pub(crate) id: String,
    pub(crate) short_id: String,
    pub(crate) summary: String,
    pub(crate) author: String,
    pub(crate) authored_ms: Option<i64>,
    pub(crate) sync_state: String,
    pub(crate) is_head: bool,
}

/// Arguments for connecting to a remote git repository.
#[derive(Deserialize)]
pub(crate) struct ConnectGitArgs {
    pub(crate) remote_url: String,
    pub(crate) branch: Option<String>,
    pub(crate) username: Option<String>,
    pub(crate) password: Option<String>,
}

/// Arguments for a fetch-merge-push sync cycle.
#[derive(Deserialize)]
pub(crate) struct GitSyncArgs {
    pub(crate) branch: Option<String>,
    pub(crate) username: Option<String>,
    pub(crate) password: Option<String>,
}

/// Arguments for committing and pushing local changes.
#[derive(Deserialize)]
pub(crate) struct GitPushArgs {
    pub(crate) message: Option<String>,
    pub(crate) branch: Option<String>,
    pub(crate) username: Option<String>,
    pub(crate) password: Option<String>,
}

/// Arguments for fetching commit history.
#[derive(Deserialize)]
pub(crate) struct GitHistoryArgs {
    pub(crate) limit: Option<usize>,
}

// ── Static ─────────────────────────────────────────────────────────────────────

static GIT_NOTE_TIMESTAMPS_CACHE: OnceLock<Mutex<HashMap<String, (Option<i64>, Option<i64>)>>> =
    OnceLock::new();

// ── Core helpers ───────────────────────────────────────────────────────────────

/// Convert a git2 error into a user-facing string.
pub(crate) fn map_git_error(error: git2::Error) -> String {
    error.message().to_string()
}

/// Open an existing git repository at the given path.
pub(crate) fn open_repo(root: &Path) -> Result<Repository, String> {
    Repository::open(root).map_err(map_git_error)
}

/// Check whether a `.git` directory exists at the given path.
pub(crate) fn git_repo_initialized(root: &Path) -> bool {
    Repository::open(root).is_ok()
}

/// Get the name of the current HEAD branch, if any.
pub(crate) fn git_current_branch(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if !head.is_branch() {
        return None;
    }
    head.shorthand().map(|value| value.to_string())
}

/// Get the URL of the "origin" remote, if configured.
pub(crate) fn git_remote_url(repo: &Repository) -> Option<String> {
    let remote = repo.find_remote("origin").ok()?;
    remote.url().map(|value| value.to_string())
}

/// True if the working tree has uncommitted changes.
pub(crate) fn git_has_changes(repo: &Repository) -> bool {
    let mut status_opts = StatusOptions::new();
    status_opts
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true);
    repo.statuses(Some(&mut status_opts))
        .map(|statuses| !statuses.is_empty())
        .unwrap_or(false)
}

// ── Timestamp cache ────────────────────────────────────────────────────────────

fn git_note_timestamps_cache() -> &'static Mutex<HashMap<String, (Option<i64>, Option<i64>)>> {
    GIT_NOTE_TIMESTAMPS_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn git_commit_timestamp_ms(commit: &git2::Commit<'_>) -> Option<i64> {
    commit.time().seconds().checked_mul(1_000)
}

fn git_tree_blob_oid(tree: &git2::Tree<'_>, path: &Path) -> Option<Oid> {
    tree.get_path(path).ok().map(|entry| entry.id())
}

/// Walk git history to find the first and last commits that touched a note.
pub(crate) fn git_note_timestamps_from_history(
    root: &Path,
    note_rel: &str,
) -> Option<(Option<i64>, Option<i64>)> {
    let repo = Repository::open(root).ok()?;
    let head_oid = repo.head().ok()?.target()?;
    let cache_key = format!("{}|{}|{}", root.to_string_lossy(), head_oid, note_rel);
    {
        let cache = git_note_timestamps_cache();
        let guard = cache.lock().ok()?;
        if let Some(cached) = guard.get(&cache_key) {
            return Some(*cached);
        }
    }

    let rel_path = Path::new(note_rel);
    let mut revwalk = repo.revwalk().ok()?;
    revwalk.push(head_oid).ok()?;

    let mut created_ms: Option<i64> = None;
    let mut updated_ms: Option<i64> = None;

    for oid_result in revwalk {
        let oid = oid_result.ok()?;
        let commit = repo.find_commit(oid).ok()?;
        let tree = commit.tree().ok()?;
        let current_blob = git_tree_blob_oid(&tree, rel_path);
        if current_blob.is_none() {
            continue;
        }

        let parent_blob = if commit.parent_count() > 0 {
            let parent = commit.parent(0).ok()?;
            let parent_tree = parent.tree().ok()?;
            git_tree_blob_oid(&parent_tree, rel_path)
        } else {
            None
        };

        if current_blob != parent_blob {
            let timestamp = git_commit_timestamp_ms(&commit);
            if updated_ms.is_none() {
                updated_ms = timestamp;
            }
            created_ms = timestamp;
        }
    }

    let result = (created_ms, updated_ms);
    let cache = git_note_timestamps_cache();
    if let Ok(mut guard) = cache.lock() {
        guard.insert(cache_key, result);
    }
    Some(result)
}

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

/// Remove bootstrap artifacts before the first sync so the remote content wins.
pub(crate) fn prepare_bootstrap_worktree_for_sync(
    root: &Path,
    repo: &Repository,
) -> Result<(), String> {
    if git_head_has_commit(repo) || !git_has_changes(repo) {
        return Ok(());
    }
    if worktree_has_only_bootstrap_artifacts(root)? {
        clear_bootstrap_artifacts(root)?;
        return Ok(());
    }
    Err("Local changes detected. Push or commit before syncing.".to_string())
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
pub(crate) fn build_git_status(root: &Path) -> GitSyncStatus {
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
pub(crate) fn build_git_history(
    root: &Path,
    limit: usize,
) -> Result<Vec<GitCommitHistoryEntry>, String> {
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

/// Open an existing repo or initialize a new one.
pub(crate) fn ensure_git_repo(root: &Path) -> Result<Repository, String> {
    if let Ok(repo) = Repository::open(root) {
        return Ok(repo);
    }
    Repository::init(root).map_err(map_git_error)
}

/// Resolve the target branch name: use provided value, current HEAD, or "main".
pub(crate) fn resolve_target_branch(repo: &Repository, branch: Option<String>) -> String {
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
pub(crate) fn build_callbacks(
    username: Option<&str>,
    password: Option<&str>,
    ssh_private_key: Option<PathBuf>,
    ssh_public_key: Option<PathBuf>,
) -> RemoteCallbacks<'static> {
    let user = username.map(str::to_string);
    let pass = password.map(str::to_string);
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |_url, username_from_url, allowed| {
        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
            if let (Some(user), Some(pass)) = (user.as_deref(), pass.as_deref()) {
                return Cred::userpass_plaintext(user, pass);
            }
        }
        if allowed.contains(CredentialType::SSH_KEY) {
            // Try key file first.
            if let Some(private_key) = &ssh_private_key {
                let ssh_user = username_from_url
                    .or(user.as_deref())
                    .unwrap_or("git");
                let pub_key = ssh_public_key.as_deref();
                if let Ok(cred) = Cred::ssh_key(ssh_user, pub_key, private_key, None) {
                    return Ok(cred);
                }
            }
            // Fall back to SSH agent.
            if let Some(name) = username_from_url {
                if let Ok(cred) = Cred::ssh_key_from_agent(name) {
                    return Ok(cred);
                }
            }
            if let Some(user) = user.as_deref() {
                if let Ok(cred) = Cred::ssh_key_from_agent(user) {
                    return Ok(cred);
                }
            }
        }
        if allowed.contains(CredentialType::DEFAULT) {
            return Cred::default();
        }
        Err(git2::Error::from_str(
            "No matching Git credentials available for this remote.",
        ))
    });
    callbacks
}

/// Create or update the "origin" remote to point at the given URL.
pub(crate) fn ensure_origin_remote(repo: &Repository, remote_url: &str) -> Result<(), String> {
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
pub(crate) fn switch_or_prepare_branch(repo: &Repository, branch: &str) -> Result<(), String> {
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
pub(crate) fn commit_all_changes(
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

// ── Fetch / merge ──────────────────────────────────────────────────────────────

/// Fetch from "origin" and return the annotated commit for the target branch.
pub(crate) fn perform_fetch<'a>(
    repo: &'a Repository,
    branch: &str,
    username: Option<&str>,
    password: Option<&str>,
    ssh_private_key: Option<PathBuf>,
    ssh_public_key: Option<PathBuf>,
) -> Result<AnnotatedCommit<'a>, String> {
    let mut remote = repo.find_remote("origin").map_err(map_git_error)?;
    let callbacks = build_callbacks(username, password, ssh_private_key, ssh_public_key);
    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);
    remote
        .fetch(&[branch], Some(&mut fetch_options), None)
        .map_err(map_git_error)?;
    let fetch_head = repo.find_reference("FETCH_HEAD").map_err(map_git_error)?;
    repo.reference_to_annotated_commit(&fetch_head)
        .map_err(map_git_error)
}

/// Fast-forward the local branch to match the fetched commit.
pub(crate) fn fast_forward_to(
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
    let stem = p.file_stem().map(|s| s.to_string_lossy()).unwrap_or_default();
    let new_name = match p.extension().map(|s| s.to_string_lossy()) {
        Some(ext) => format!("{stem}.conflict.{ext}"),
        None => format!("{stem}.conflict"),
    };
    p.with_file_name(new_name).to_string_lossy().to_string()
}

/// Merge a fetched commit, saving `.conflict` files when there are conflicts.
pub(crate) fn merge_fetched_commit(
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
                        fs::write(&full_path, their_blob.content())
                            .map_err(|e| e.to_string())?;
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
                    index
                        .add_path(Path::new(rel_path))
                        .map_err(map_git_error)?;
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
