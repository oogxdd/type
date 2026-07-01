//! App-managed Ed25519 SSH keypair lifecycle for git sync.
//!
//! Orthogonal to the libgit2 sync engine: this owns the keypair files under
//! `<app_data_dir>/ssh/`. The sync engine's credentials callback consumes the
//! key paths via `ssh_private_key_if_exists` / `ssh_public_key_if_exists`.

use crate::AppEnv;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use crate::app_data_dir;

const SSH_DIR_NAME: &str = "ssh";
const SSH_PRIVATE_KEY_NAME: &str = "id_ed25519";
const SSH_PUBLIC_KEY_NAME: &str = "id_ed25519.pub";

fn ssh_dir(app: &AppEnv) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(SSH_DIR_NAME))
}

fn ssh_private_key_path(app: &AppEnv) -> Result<PathBuf, String> {
    Ok(ssh_dir(app)?.join(SSH_PRIVATE_KEY_NAME))
}

fn ssh_public_key_path(app: &AppEnv) -> Result<PathBuf, String> {
    Ok(ssh_dir(app)?.join(SSH_PUBLIC_KEY_NAME))
}

/// Generate an Ed25519 SSH keypair using ssh-keygen.
pub fn generate_ssh_keypair(app: &AppEnv) -> Result<String, String> {
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
pub fn read_ssh_public_key(app: &AppEnv) -> Result<Option<String>, String> {
    let path = ssh_public_key_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(content.trim().to_string()))
}

/// Delete the SSH keypair.
pub fn delete_ssh_keypair(app: &AppEnv) -> Result<(), String> {
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
pub fn ssh_private_key_if_exists(app: &AppEnv) -> Option<PathBuf> {
    ssh_private_key_path(app).ok().filter(|p| p.exists())
}

/// Return the public key path if it exists, for use in credentials callbacks.
pub fn ssh_public_key_if_exists(app: &AppEnv) -> Option<PathBuf> {
    ssh_public_key_path(app).ok().filter(|p| p.exists())
}
