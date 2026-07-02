//! Git sync (libgit2) for the active working folder, mirroring the desktop
//! `commands/git_sync.rs` surface. The SSH-key functions are usable while
//! locked, exactly like the desktop shell.

use type_core::{
    application::git_sync::GitSyncUseCases, ConnectGitArgs, GitHistoryArgs, GitPushArgs,
    GitSyncAdapter, GitSyncArgs,
};

use crate::{current_env, from_json, run_blocking, to_json, unlocked_env, CoreError};

fn git_sync_use_cases() -> Result<GitSyncUseCases<GitSyncAdapter>, String> {
    Ok(GitSyncUseCases::new(GitSyncAdapter::new(unlocked_env()?)))
}

fn git_sync_use_cases_unlocked_not_required() -> Result<GitSyncUseCases<GitSyncAdapter>, String> {
    Ok(GitSyncUseCases::new(GitSyncAdapter::new(current_env()?)))
}

/// Generate the app-managed Ed25519 keypair; returns the public key.
#[uniffi::export(async_runtime = "tokio")]
pub async fn generate_ssh_key() -> Result<String, CoreError> {
    run_blocking(|| git_sync_use_cases_unlocked_not_required()?.generate_ssh_key()).await
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn get_ssh_public_key() -> Result<Option<String>, CoreError> {
    run_blocking(|| git_sync_use_cases_unlocked_not_required()?.ssh_public_key()).await
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn delete_ssh_key() -> Result<(), CoreError> {
    run_blocking(|| git_sync_use_cases_unlocked_not_required()?.delete_ssh_key()).await
}

/// Sync status of the active working folder as JSON (`GitSyncStatus`).
#[uniffi::export(async_runtime = "tokio")]
pub async fn get_git_status() -> Result<String, CoreError> {
    run_blocking(|| to_json(&git_sync_use_cases()?.status()?)).await
}

/// `args_json`: optional `GitHistoryArgs`. Returns JSON `Vec<GitCommitHistoryEntry>`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn get_git_history(args_json: Option<String>) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: Option<GitHistoryArgs> = match args_json {
            Some(json) => Some(from_json(&json)?),
            None => None,
        };
        to_json(&git_sync_use_cases()?.history(args)?)
    })
    .await
}

/// `args_json`: `ConnectGitArgs`. Returns JSON `GitSyncStatus`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn connect_git_repo(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: ConnectGitArgs = from_json(&args_json)?;
        to_json(&git_sync_use_cases()?.connect(args)?)
    })
    .await
}

/// `args_json`: `GitSyncArgs`. Returns JSON `GitSyncStatus`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn git_pull(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: GitSyncArgs = from_json(&args_json)?;
        to_json(&git_sync_use_cases()?.pull(args)?)
    })
    .await
}

/// `args_json`: `GitPushArgs`. Returns JSON `GitSyncStatus`.
#[uniffi::export(async_runtime = "tokio")]
pub async fn git_push(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: GitPushArgs = from_json(&args_json)?;
        to_json(&git_sync_use_cases()?.push(args)?)
    })
    .await
}
