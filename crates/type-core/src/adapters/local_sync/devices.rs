//! Authorized-devices store + host key for the embedded SSH sync server.
//!
//! Both live under `<app_data_dir>/local_sync/`: the Ed25519 host key as an
//! OpenSSH private key file, and the paired phone keys as `devices.json`.
//! Everything is exchanged as OpenSSH text so the ssh-key/russh crate versions
//! never have to agree on binary types.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::{app_data_dir, now_ms, AppEnv};
use rand_core::{OsRng, RngCore};
use ssh_key::{Algorithm, HashAlg, LineEnding, PrivateKey};

const LOCAL_SYNC_DIR: &str = "local_sync";
const HOST_KEY_FILE: &str = "host_key";
const DEVICES_FILE: &str = "devices.json";

/// One paired device (a phone whose key may use the sync server).
#[derive(Clone, Serialize, Deserialize)]
pub struct PairedDevice {
    pub name: String,
    /// `"<algorithm> <base64>"` — an OpenSSH public key line without comment.
    pub public_key: String,
    pub added_ms: i64,
}

fn local_sync_dir(app: &AppEnv) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join(LOCAL_SYNC_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub(super) fn devices_path(app: &AppEnv) -> Result<PathBuf, String> {
    Ok(local_sync_dir(app)?.join(DEVICES_FILE))
}

/// Load (or create on first use) the server host key. Returns the OpenSSH
/// private key text and the `SHA256:...` public key fingerprint that clients
/// pin via the QR code.
pub(super) fn ensure_host_key(app: &AppEnv) -> Result<(String, String), String> {
    let path = local_sync_dir(app)?.join(HOST_KEY_FILE);
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let key = PrivateKey::from_openssh(&content)
            .map_err(|e| format!("Sync server host key is unreadable: {e}"))?;
        let fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
        return Ok((content, fingerprint));
    }
    let mut key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519)
        .map_err(|e| format!("Failed to generate the sync server host key: {e}"))?;
    key.set_comment("type-local-sync-host");
    let content = key
        .to_openssh(LineEnding::LF)
        .map_err(|e| format!("Failed to encode the sync server host key: {e}"))?
        .to_string();
    fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    let fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
    Ok((content, fingerprint))
}

/// Random pairing token for one server run (hex, QR-safe).
pub(super) fn generate_pairing_token() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(super) fn list_devices(path: &Path) -> Vec<PairedDevice> {
    if !path.exists() {
        return Vec::new();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

/// Normalize an OpenSSH public key line to `"<algorithm> <base64>"` (drops the
/// comment so lookups don't depend on it).
pub(super) fn normalize_key_line(line: &str) -> Option<String> {
    let mut fields = line.split_whitespace();
    let algorithm = fields.next()?;
    let base64 = fields.next()?;
    Some(format!("{algorithm} {base64}"))
}

pub(super) fn is_authorized(path: &Path, key_line: &str) -> bool {
    list_devices(path)
        .iter()
        .any(|device| device.public_key == key_line)
}

pub(super) fn register_device(path: &Path, key_line: &str, name: &str) -> Result<(), String> {
    let mut devices = list_devices(path);
    if devices.iter().any(|device| device.public_key == key_line) {
        return Ok(());
    }
    devices.push(PairedDevice {
        name: name.to_string(),
        public_key: key_line.to_string(),
        added_ms: now_ms().unwrap_or(0),
    });
    let content = serde_json::to_string_pretty(&devices).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

/// The comment-less key line for a key offered over SSH (russh's re-exported
/// ssh-key version may differ from ours, so go through OpenSSH text).
pub(super) fn public_key_line(key: &russh::keys::PublicKey) -> Option<String> {
    normalize_key_line(&key.to_openssh().ok()?)
}

/// Human label for a pairing device: the key comment when present.
pub(super) fn device_name_from_key(key: &russh::keys::PublicKey) -> String {
    let comment = key.comment().to_string();
    if comment.trim().is_empty() {
        "Phone".to_string()
    } else {
        comment
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_and_authorizes_devices() {
        let dir = std::env::temp_dir().join(format!("type-devices-{}", generate_pairing_token()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(DEVICES_FILE);

        let key_line = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP///w";
        assert!(!is_authorized(&path, key_line));
        register_device(&path, key_line, "iPhone").unwrap();
        assert!(is_authorized(&path, key_line));
        // Idempotent.
        register_device(&path, key_line, "iPhone").unwrap();
        assert_eq!(list_devices(&path).len(), 1);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn normalizes_key_lines() {
        assert_eq!(
            normalize_key_line("ssh-ed25519 QUJD my comment").as_deref(),
            Some("ssh-ed25519 QUJD")
        );
        assert_eq!(normalize_key_line("ssh-ed25519"), None);
    }

    #[test]
    fn pairing_tokens_are_unique_hex() {
        let a = generate_pairing_token();
        let b = generate_pairing_token();
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
