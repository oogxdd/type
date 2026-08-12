use argon2::password_hash::rand_core::{OsRng, RngCore};
use base64::{
    engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD},
    Engine as _,
};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    Key, XChaCha20Poly1305, XNonce,
};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use zeroize::Zeroize;

const SYNC_PEER_PROTOCOL_VERSION: u8 = 1;
const SYNC_PEER_KEY_SIZE: usize = 32;
const SYNC_PEER_NONCE_SIZE: usize = 24;
const SYNC_PEER_OBJECT_ID_SIZE: usize = 32;
const SYNC_PEER_MAX_INLINE_BYTES: usize = 16 * 1024 * 1024;
const SYNC_PEER_KDF_SALT: &[u8] = b"type/sync-peer/kdf/v1";
const SYNC_PEER_OBJECT_KEY_INFO: &[u8] = b"encrypted-operation-envelope";
const SYNC_PEER_AAD_PREFIX: &[u8] = b"type/sync-peer/envelope/v1\0";

/// Random vault root key shared only among trusted Type devices.
///
/// The peer receives an Iroh document read capability but never this key.
pub struct SyncPeerVaultKey([u8; SYNC_PEER_KEY_SIZE]);

impl SyncPeerVaultKey {
    pub fn generate() -> Self {
        let mut bytes = [0u8; SYNC_PEER_KEY_SIZE];
        OsRng.fill_bytes(&mut bytes);
        Self(bytes)
    }

    pub fn from_base64(encoded: &str) -> Result<Self, String> {
        let bytes = URL_SAFE_NO_PAD
            .decode(encoded.trim())
            .map_err(|_| "Sync peer vault key is not valid base64url.".to_string())?;
        if bytes.len() != SYNC_PEER_KEY_SIZE {
            return Err("Sync peer vault key must contain exactly 32 bytes.".to_string());
        }
        let mut key = [0u8; SYNC_PEER_KEY_SIZE];
        key.copy_from_slice(&bytes);
        Ok(Self(key))
    }

    pub fn to_base64(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.0)
    }
}

impl fmt::Debug for SyncPeerVaultKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SyncPeerVaultKey([REDACTED])")
    }
}

impl Drop for SyncPeerVaultKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// Plaintext operation. It exists only on trusted devices and is encrypted as
/// a whole, including the path and operation metadata.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct SyncPeerOperation {
    protocol_version: u8,
    pub device_id: String,
    pub sequence: u64,
    pub previous_operation_id: Option<String>,
    pub created_at_ms: i64,
    pub payload: SyncPeerOperationPayload,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SyncPeerOperationPayload {
    MarkdownUpsert {
        path: String,
        base_sha256: Option<String>,
        content_sha256: String,
        content_base64: String,
    },
    FilesystemDelete {
        path: String,
        base_sha256: Option<String>,
    },
    MacDurabilityReceipt {
        acknowledged_operation_id: String,
        content_sha256: String,
        byte_length: u64,
    },
}

impl SyncPeerOperation {
    pub fn markdown_upsert(
        device_id: impl Into<String>,
        sequence: u64,
        previous_operation_id: Option<String>,
        created_at_ms: i64,
        path: impl Into<String>,
        base_sha256: Option<String>,
        content: &[u8],
    ) -> Result<Self, String> {
        let operation = Self {
            protocol_version: SYNC_PEER_PROTOCOL_VERSION,
            device_id: device_id.into(),
            sequence,
            previous_operation_id,
            created_at_ms,
            payload: SyncPeerOperationPayload::MarkdownUpsert {
                path: path.into(),
                base_sha256,
                content_sha256: sha256_hex(content),
                content_base64: BASE64.encode(content),
            },
        };
        operation.validate()?;
        Ok(operation)
    }

    pub fn filesystem_delete(
        device_id: impl Into<String>,
        sequence: u64,
        previous_operation_id: Option<String>,
        created_at_ms: i64,
        path: impl Into<String>,
        base_sha256: Option<String>,
    ) -> Result<Self, String> {
        let operation = Self {
            protocol_version: SYNC_PEER_PROTOCOL_VERSION,
            device_id: device_id.into(),
            sequence,
            previous_operation_id,
            created_at_ms,
            payload: SyncPeerOperationPayload::FilesystemDelete {
                path: path.into(),
                base_sha256,
            },
        };
        operation.validate()?;
        Ok(operation)
    }

    pub fn mac_durability_receipt(
        device_id: impl Into<String>,
        sequence: u64,
        previous_operation_id: Option<String>,
        created_at_ms: i64,
        acknowledged_operation_id: impl Into<String>,
        content_sha256: impl Into<String>,
        byte_length: u64,
    ) -> Result<Self, String> {
        let operation = Self {
            protocol_version: SYNC_PEER_PROTOCOL_VERSION,
            device_id: device_id.into(),
            sequence,
            previous_operation_id,
            created_at_ms,
            payload: SyncPeerOperationPayload::MacDurabilityReceipt {
                acknowledged_operation_id: acknowledged_operation_id.into(),
                content_sha256: content_sha256.into(),
                byte_length,
            },
        };
        operation.validate()?;
        Ok(operation)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.protocol_version != SYNC_PEER_PROTOCOL_VERSION {
            return Err("Unsupported sync peer operation version.".to_string());
        }
        let device_id = self.device_id.trim();
        if device_id.is_empty() || device_id.len() > 128 {
            return Err("Sync peer device id must contain 1 to 128 characters.".to_string());
        }
        if self.sequence == 0 {
            return Err("Sync peer sequence must start at one.".to_string());
        }
        if self.created_at_ms < 0 {
            return Err("Sync peer operation timestamp cannot be negative.".to_string());
        }
        if let Some(previous) = &self.previous_operation_id {
            validate_object_id(previous)?;
        }

        match &self.payload {
            SyncPeerOperationPayload::MarkdownUpsert {
                path,
                base_sha256,
                content_sha256,
                content_base64,
            } => {
                validate_markdown_path(path)?;
                validate_optional_sha256(base_sha256.as_deref())?;
                validate_sha256(content_sha256)?;
                let content = BASE64
                    .decode(content_base64)
                    .map_err(|_| "Sync peer Markdown content is not valid base64.".to_string())?;
                if content.len() > SYNC_PEER_MAX_INLINE_BYTES {
                    return Err("Sync peer Markdown operation is larger than 16 MiB.".to_string());
                }
                if sha256_hex(&content) != *content_sha256 {
                    return Err("Sync peer Markdown content hash does not match.".to_string());
                }
            }
            SyncPeerOperationPayload::FilesystemDelete { path, base_sha256 } => {
                validate_relative_path(path)?;
                validate_optional_sha256(base_sha256.as_deref())?;
            }
            SyncPeerOperationPayload::MacDurabilityReceipt {
                acknowledged_operation_id,
                content_sha256,
                ..
            } => {
                validate_object_id(acknowledged_operation_id)?;
                validate_sha256(content_sha256)?;
            }
        }
        Ok(())
    }

    pub fn markdown_content(&self) -> Result<Option<Vec<u8>>, String> {
        match &self.payload {
            SyncPeerOperationPayload::MarkdownUpsert { content_base64, .. } => BASE64
                .decode(content_base64)
                .map(Some)
                .map_err(|_| "Sync peer Markdown content is not valid base64.".to_string()),
            _ => Ok(None),
        }
    }
}

/// Ciphertext stored as an `iroh-docs` value. The random object id is used as
/// the document entry key and as authenticated associated data.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct EncryptedSyncPeerEnvelope {
    protocol_version: u8,
    nonce_base64: String,
    ciphertext_base64: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncryptedSyncPeerObject {
    pub object_id: String,
    pub envelope: EncryptedSyncPeerEnvelope,
}

impl EncryptedSyncPeerEnvelope {
    pub fn to_bytes(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec(self).map_err(|error| error.to_string())
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        let envelope = serde_json::from_slice::<Self>(bytes)
            .map_err(|_| "Sync peer envelope is not valid JSON.".to_string())?;
        if envelope.protocol_version != SYNC_PEER_PROTOCOL_VERSION {
            return Err("Unsupported sync peer envelope version.".to_string());
        }
        Ok(envelope)
    }
}

pub fn encrypt_sync_peer_operation(
    vault_key: &SyncPeerVaultKey,
    operation: &SyncPeerOperation,
) -> Result<EncryptedSyncPeerObject, String> {
    operation.validate()?;
    let plaintext = serde_json::to_vec(operation).map_err(|error| error.to_string())?;
    let object_id = generate_object_id();
    let aad = object_aad(&object_id);
    let mut object_key = derive_object_key(vault_key)?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&object_key));
    let mut nonce = [0u8; SYNC_PEER_NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| "Failed to encrypt sync peer operation.".to_string());
    object_key.zeroize();

    Ok(EncryptedSyncPeerObject {
        object_id,
        envelope: EncryptedSyncPeerEnvelope {
            protocol_version: SYNC_PEER_PROTOCOL_VERSION,
            nonce_base64: BASE64.encode(nonce),
            ciphertext_base64: BASE64.encode(ciphertext?),
        },
    })
}

pub fn decrypt_sync_peer_operation(
    vault_key: &SyncPeerVaultKey,
    object_id: &str,
    envelope: &EncryptedSyncPeerEnvelope,
) -> Result<SyncPeerOperation, String> {
    validate_object_id(object_id)?;
    if envelope.protocol_version != SYNC_PEER_PROTOCOL_VERSION {
        return Err("Unsupported sync peer envelope version.".to_string());
    }
    let nonce = BASE64
        .decode(&envelope.nonce_base64)
        .map_err(|_| "Sync peer envelope nonce is not valid base64.".to_string())?;
    if nonce.len() != SYNC_PEER_NONCE_SIZE {
        return Err("Sync peer envelope nonce must contain exactly 24 bytes.".to_string());
    }
    let ciphertext = BASE64
        .decode(&envelope.ciphertext_base64)
        .map_err(|_| "Sync peer envelope ciphertext is not valid base64.".to_string())?;
    let aad = object_aad(object_id);
    let mut object_key = derive_object_key(vault_key)?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&object_key));
    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| "Sync peer envelope authentication failed.".to_string());
    object_key.zeroize();
    let plaintext = plaintext?;
    let operation = serde_json::from_slice::<SyncPeerOperation>(&plaintext)
        .map_err(|_| "Decrypted sync peer operation is invalid.".to_string())?;
    operation.validate()?;
    Ok(operation)
}

fn derive_object_key(vault_key: &SyncPeerVaultKey) -> Result<[u8; SYNC_PEER_KEY_SIZE], String> {
    let hkdf = Hkdf::<Sha256>::new(Some(SYNC_PEER_KDF_SALT), &vault_key.0);
    let mut key = [0u8; SYNC_PEER_KEY_SIZE];
    hkdf.expand(SYNC_PEER_OBJECT_KEY_INFO, &mut key)
        .map_err(|_| "Failed to derive sync peer object key.".to_string())?;
    Ok(key)
}

fn generate_object_id() -> String {
    let mut bytes = [0u8; SYNC_PEER_OBJECT_ID_SIZE];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn object_aad(object_id: &str) -> Vec<u8> {
    let mut aad = Vec::with_capacity(SYNC_PEER_AAD_PREFIX.len() + object_id.len());
    aad.extend_from_slice(SYNC_PEER_AAD_PREFIX);
    aad.extend_from_slice(object_id.as_bytes());
    aad
}

fn validate_object_id(object_id: &str) -> Result<(), String> {
    let decoded = URL_SAFE_NO_PAD
        .decode(object_id)
        .map_err(|_| "Sync peer object id is not valid base64url.".to_string())?;
    if decoded.len() != SYNC_PEER_OBJECT_ID_SIZE {
        return Err("Sync peer object id must contain exactly 32 bytes.".to_string());
    }
    Ok(())
}

fn validate_relative_path(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Sync peer operation path cannot be empty.".to_string());
    }
    crate::sanitize_relative(path)?;
    Ok(())
}

fn validate_markdown_path(path: &str) -> Result<(), String> {
    validate_relative_path(path)?;
    if !path.to_ascii_lowercase().ends_with(".md") {
        return Err("Sync peer Markdown operation path must end in .md.".to_string());
    }
    Ok(())
}

fn validate_optional_sha256(value: Option<&str>) -> Result<(), String> {
    if let Some(value) = value {
        validate_sha256(value)?;
    }
    Ok(())
}

fn validate_sha256(value: &str) -> Result<(), String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Sync peer SHA-256 value is invalid.".to_string());
    }
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_operation() -> SyncPeerOperation {
        SyncPeerOperation::markdown_upsert(
            "phone-01",
            1,
            None,
            1_725_000_000_000,
            "Journal/private-note.md",
            None,
            b"very private note contents",
        )
        .unwrap()
    }

    #[test]
    fn encrypted_envelope_round_trips_without_plaintext_metadata() {
        let key = SyncPeerVaultKey::generate();
        let operation = sample_operation();
        let encrypted = encrypt_sync_peer_operation(&key, &operation).unwrap();
        let stored = encrypted.envelope.to_bytes().unwrap();

        assert!(!stored
            .windows(b"private-note.md".len())
            .any(|window| window == b"private-note.md"));
        assert!(!stored
            .windows(b"very private note contents".len())
            .any(|window| window == b"very private note contents"));

        let parsed = EncryptedSyncPeerEnvelope::from_bytes(&stored).unwrap();
        let decrypted = decrypt_sync_peer_operation(&key, &encrypted.object_id, &parsed).unwrap();
        assert_eq!(decrypted, operation);
        assert_eq!(
            decrypted.markdown_content().unwrap().unwrap(),
            b"very private note contents"
        );
    }

    #[test]
    fn changing_the_opaque_object_id_breaks_authentication() {
        let key = SyncPeerVaultKey::generate();
        let encrypted = encrypt_sync_peer_operation(&key, &sample_operation()).unwrap();
        let other_id = generate_object_id();

        let error = decrypt_sync_peer_operation(&key, &other_id, &encrypted.envelope).unwrap_err();
        assert_eq!(error, "Sync peer envelope authentication failed.");
    }

    #[test]
    fn wrong_vault_key_cannot_decrypt_an_envelope() {
        let key = SyncPeerVaultKey::generate();
        let other_key = SyncPeerVaultKey::generate();
        let encrypted = encrypt_sync_peer_operation(&key, &sample_operation()).unwrap();

        assert!(
            decrypt_sync_peer_operation(&other_key, &encrypted.object_id, &encrypted.envelope)
                .is_err()
        );
    }

    #[test]
    fn validation_rejects_traversal_and_content_tampering() {
        let traversal =
            SyncPeerOperation::filesystem_delete("phone-01", 1, None, 1, "../secrets.md", None)
                .unwrap_err();
        assert_eq!(traversal, "Invalid path traversal.");

        let mut operation = sample_operation();
        if let SyncPeerOperationPayload::MarkdownUpsert { content_base64, .. } =
            &mut operation.payload
        {
            *content_base64 = BASE64.encode(b"changed");
        }
        assert_eq!(
            operation.validate().unwrap_err(),
            "Sync peer Markdown content hash does not match."
        );
    }

    #[test]
    fn vault_key_uses_url_safe_round_trip_encoding() {
        let key = SyncPeerVaultKey::generate();
        let encoded = key.to_base64();
        assert_eq!(encoded.len(), 43);
        assert!(!encoded.contains('='));
        assert_eq!(
            SyncPeerVaultKey::from_base64(&encoded).unwrap().to_base64(),
            encoded
        );
    }
}
