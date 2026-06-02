use crate::*;

#[tauri::command]
pub(super) fn generate_ssh_key(app: tauri::AppHandle) -> Result<String, String> {
    generate_ssh_keypair(&app)
}

#[tauri::command]
pub(super) fn get_ssh_public_key(app: tauri::AppHandle) -> Result<Option<String>, String> {
    read_ssh_public_key(&app)
}

#[tauri::command]
pub(super) fn delete_ssh_key(app: tauri::AppHandle) -> Result<(), String> {
    delete_ssh_keypair(&app)
}

#[tauri::command]
pub(super) async fn get_git_status(app: tauri::AppHandle) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    super::run_blocking_command(move || get_git_status_blocking(app)).await
}

#[tauri::command]
pub(super) async fn get_git_history(
    app: tauri::AppHandle,
    args: Option<GitHistoryArgs>,
) -> Result<Vec<GitCommitHistoryEntry>, String> {
    ensure_security_unlocked_for_app(&app)?;
    super::run_blocking_command(move || {
        ensure_security_unlocked_for_app(&app)?;
        let root = ensured_notes_root(&app)?;
        let limit = args.and_then(|value| value.limit).unwrap_or(40);
        build_git_history(&root, limit)
    })
    .await
}

fn get_git_status_blocking(app: tauri::AppHandle) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    Ok(build_git_status(&root))
}

#[tauri::command]
pub(super) async fn connect_git_repo(
    app: tauri::AppHandle,
    args: ConnectGitArgs,
) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    super::run_blocking_command(move || connect_git_repo_blocking(app, args)).await
}

fn connect_git_repo_blocking(
    app: tauri::AppHandle,
    args: ConnectGitArgs,
) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    let repo = ensure_git_repo(&root)?;
    prepare_bootstrap_worktree_for_sync(&root, &repo)?;
    ensure_origin_remote(&repo, &args.remote_url)?;
    let target_branch = resolve_target_branch(&repo, args.branch.clone());
    switch_or_prepare_branch(&repo, &target_branch)?;
    let ssh_priv = ssh_private_key_if_exists(&app);
    let ssh_pub = ssh_public_key_if_exists(&app);
    let fetched = match perform_fetch(
        &repo,
        &target_branch,
        args.username.as_deref(),
        args.password.as_deref(),
        ssh_priv,
        ssh_pub,
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

#[tauri::command]
pub(super) async fn git_pull(
    app: tauri::AppHandle,
    args: GitSyncArgs,
) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    super::run_blocking_command(move || git_pull_blocking(app, args)).await
}

fn git_pull_blocking(app: tauri::AppHandle, args: GitSyncArgs) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    if !git_repo_initialized(&root) {
        return Err("Repository is not initialized. Connect a remote first.".to_string());
    }
    let repo = open_repo(&root)?;
    prepare_bootstrap_worktree_for_sync(&root, &repo)?;
    if git_has_changes(&repo) {
        return Err("Local changes detected. Push or commit before pulling.".to_string());
    }
    let target_branch = resolve_target_branch(&repo, args.branch.clone());
    switch_or_prepare_branch(&repo, &target_branch)?;
    let ssh_priv = ssh_private_key_if_exists(&app);
    let ssh_pub = ssh_public_key_if_exists(&app);
    let fetched = perform_fetch(
        &repo,
        &target_branch,
        args.username.as_deref(),
        args.password.as_deref(),
        ssh_priv,
        ssh_pub,
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

fn remote_push(
    repo: &Repository,
    branch: &str,
    username: Option<&str>,
    password: Option<&str>,
    ssh_private_key: Option<std::path::PathBuf>,
    ssh_public_key: Option<std::path::PathBuf>,
) -> Result<(), String> {
    let callbacks = build_callbacks(username, password, ssh_private_key.clone(), ssh_public_key.clone());
    let mut push_options = PushOptions::new();
    push_options.remote_callbacks(callbacks);
    let mut remote = repo.find_remote("origin").map_err(map_git_error)?;
    remote
        .connect_auth(
            Direction::Push,
            Some(build_callbacks(username, password, ssh_private_key, ssh_public_key)),
            None,
        )
        .map_err(map_git_error)?;
    remote
        .push(
            &[&format!("refs/heads/{0}:refs/heads/{0}", branch)],
            Some(&mut push_options),
        )
        .map_err(map_git_error)?;
    let mut local = repo
        .find_branch(branch, git2::BranchType::Local)
        .map_err(map_git_error)?;
    local
        .set_upstream(Some(&format!("origin/{}", branch)))
        .map_err(map_git_error)?;
    Ok(())
}

#[tauri::command]
pub(super) async fn git_push(
    app: tauri::AppHandle,
    args: GitPushArgs,
) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    super::run_blocking_command(move || git_push_blocking(app, args)).await
}

fn git_push_blocking(app: tauri::AppHandle, args: GitPushArgs) -> Result<GitSyncStatus, String> {
    ensure_security_unlocked_for_app(&app)?;
    let root = ensured_notes_root(&app)?;
    if !git_repo_initialized(&root) {
        return Err("Repository is not initialized. Connect a remote first.".to_string());
    }
    let repo = open_repo(&root)?;
    let target_branch = resolve_target_branch(&repo, args.branch.clone());
    switch_or_prepare_branch(&repo, &target_branch)?;
    let message = args
        .message
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("Sync notes");
    let status_before_push = build_git_status(&root);
    if !status_before_push.push_required {
        return Ok(status_before_push);
    }
    let _ = commit_all_changes(&repo, message, &target_branch)?;
    let ssh_priv = ssh_private_key_if_exists(&app);
    let ssh_pub = ssh_public_key_if_exists(&app);
    remote_push(
        &repo,
        &target_branch,
        args.username.as_deref(),
        args.password.as_deref(),
        ssh_priv,
        ssh_pub,
    )?;
    Ok(build_git_status(&root))
}
