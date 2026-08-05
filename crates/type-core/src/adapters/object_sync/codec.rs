//! Phase-1 codec: keys derived straight from the content hash, payloads stored
//! as-is.
//!
//! This is the seam phase 2 replaces. Everything above it — the engine, the
//! scheduler, the manifests — is written against [`ObjectCodec`] and does not
//! know whether bytes are encrypted.

use crate::domain::object_sync::Manifest;
use crate::ports::object_sync::{ObjectCodec, ObjectStoreSettings};

use super::crypto::{open, opaque_name, seal, Subkeys, VaultKey};

pub const OBJECTS_SEGMENT: &str = "objects";
pub const MANIFESTS_SEGMENT: &str = "manifests";
pub const REPO_OBJECT: &str = "repo.json";
pub const VAULT_OBJECT: &str = "vault.json";

/// Keys and payloads with no transformation applied.
pub struct PlaintextCodec {
    prefix: String,
}

impl PlaintextCodec {
    pub fn new(settings: &ObjectStoreSettings) -> Self {
        Self {
            prefix: settings.normalized_prefix(),
        }
    }

    fn key(&self, suffix: &str) -> String {
        if self.prefix.is_empty() {
            suffix.to_string()
        } else {
            format!("{}/{suffix}", self.prefix)
        }
    }
}

impl ObjectCodec for PlaintextCodec {
    fn object_key(&self, content_hash: &str) -> String {
        self.key(&format!("{OBJECTS_SEGMENT}/{content_hash}"))
    }

    fn manifest_key(&self, device_id: &str) -> String {
        self.key(&format!("{MANIFESTS_SEGMENT}/{device_id}.json"))
    }

    fn manifest_prefix(&self) -> String {
        self.key(&format!("{MANIFESTS_SEGMENT}/"))
    }

    fn encode_blob(&self, _key: &str, plaintext: Vec<u8>) -> Result<Vec<u8>, String> {
        Ok(plaintext)
    }

    fn decode_blob(&self, _key: &str, stored: Vec<u8>) -> Result<Vec<u8>, String> {
        Ok(stored)
    }

    fn encode_manifest(&self, _key: &str, manifest: &Manifest) -> Result<Vec<u8>, String> {
        serde_json::to_vec(manifest)
            .map_err(|error| format!("Failed to serialize manifest: {error}"))
    }

    fn decode_manifest(&self, key: &str, stored: Vec<u8>) -> Result<Manifest, String> {
        serde_json::from_slice(&stored)
            .map_err(|error| format!("Failed to parse manifest '{key}': {error}"))
    }
}

/// Everything above this line is the plaintext (phase 1) codec. Below is the
/// encrypted one; the engine is written against the trait and cannot tell them
/// apart.

/// Opaque keys and AEAD payloads.
///
/// Object keys are HMACs of the content hash rather than the hash itself, so
/// the bucket cannot confirm a guess about a note's contents by hashing it.
/// Manifests are encrypted too, which is what keeps filenames, folder
/// structure, timestamps and tombstones off the provider entirely.
pub struct EncryptedCodec {
    prefix: String,
    subkeys: Subkeys,
}

impl EncryptedCodec {
    pub fn new(settings: &ObjectStoreSettings, vault_key: &VaultKey) -> Self {
        Self {
            prefix: settings.normalized_prefix(),
            subkeys: vault_key.subkeys(),
        }
    }

    fn key(&self, suffix: &str) -> String {
        if self.prefix.is_empty() {
            suffix.to_string()
        } else {
            format!("{}/{suffix}", self.prefix)
        }
    }
}

impl ObjectCodec for EncryptedCodec {
    fn object_key(&self, content_hash: &str) -> String {
        // An empty hash means "the objects prefix" (garbage collection lists
        // with it), which must stay a plain prefix rather than become an HMAC.
        if content_hash.is_empty() {
            return self.key(&format!("{OBJECTS_SEGMENT}/"));
        }
        self.key(&format!(
            "{OBJECTS_SEGMENT}/{}",
            opaque_name(&self.subkeys.name, content_hash)
        ))
    }

    fn manifest_key(&self, device_id: &str) -> String {
        // Device ids are already random, so they reveal nothing worth hiding.
        self.key(&format!("{MANIFESTS_SEGMENT}/{device_id}.json"))
    }

    fn manifest_prefix(&self) -> String {
        self.key(&format!("{MANIFESTS_SEGMENT}/"))
    }

    fn encode_blob(&self, key: &str, plaintext: Vec<u8>) -> Result<Vec<u8>, String> {
        seal(&self.subkeys.content, key.as_bytes(), &plaintext)
    }

    fn decode_blob(&self, key: &str, stored: Vec<u8>) -> Result<Vec<u8>, String> {
        open(&self.subkeys.content, key.as_bytes(), &stored)
    }

    fn encode_manifest(&self, key: &str, manifest: &Manifest) -> Result<Vec<u8>, String> {
        let json = serde_json::to_vec(manifest)
            .map_err(|error| format!("Failed to serialize manifest: {error}"))?;
        seal(&self.subkeys.manifest, key.as_bytes(), &json)
    }

    fn decode_manifest(&self, key: &str, stored: Vec<u8>) -> Result<Manifest, String> {
        let json = open(&self.subkeys.manifest, key.as_bytes(), &stored)
            .map_err(|error| format!("Could not read manifest '{key}': {error}"))?;
        serde_json::from_slice(&json)
            .map_err(|error| format!("Failed to parse manifest '{key}': {error}"))
    }

    fn is_encrypted(&self) -> bool {
        true
    }
}

/// The repo marker's key, which is the same regardless of codec — a device has
/// to read it *before* it knows whether the bucket is encrypted.
pub fn repo_key(settings: &ObjectStoreSettings) -> String {
    settings.key_for(REPO_OBJECT)
}

/// `<prefix>/vault.json`, the passphrase-wrapped key. Plaintext by necessity:
/// a new device fetches it *in order to* get a key.
pub fn vault_key_object(settings: &ObjectStoreSettings) -> String {
    settings.key_for(VAULT_OBJECT)
}

/// Pull the device id back out of a manifest key, for listing peers.
pub fn device_id_from_manifest_key(key: &str) -> Option<&str> {
    key.rsplit('/').next()?.strip_suffix(".json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::object_sync::ManifestEntry;

    fn settings(prefix: &str) -> ObjectStoreSettings {
        ObjectStoreSettings {
            endpoint: "https://example.com".to_string(),
            bucket: "notes".to_string(),
            prefix: prefix.to_string(),
            ..ObjectStoreSettings::default()
        }
    }

    #[test]
    fn keys_sit_under_the_configured_prefix() {
        let codec = PlaintextCodec::new(&settings("type-notes/p1"));
        assert_eq!(codec.object_key("abc"), "type-notes/p1/objects/abc");
        assert_eq!(codec.manifest_key("dev1"), "type-notes/p1/manifests/dev1.json");
        assert_eq!(codec.manifest_prefix(), "type-notes/p1/manifests/");
        assert_eq!(repo_key(&settings("type-notes/p1")), "type-notes/p1/repo.json");
    }

    #[test]
    fn stray_slashes_in_the_prefix_do_not_double_up() {
        let codec = PlaintextCodec::new(&settings("/type-notes/p1/"));
        assert_eq!(codec.object_key("abc"), "type-notes/p1/objects/abc");
    }

    #[test]
    fn an_empty_prefix_puts_objects_at_the_bucket_root() {
        let codec = PlaintextCodec::new(&settings(""));
        assert_eq!(codec.object_key("abc"), "objects/abc");
        assert_eq!(codec.manifest_prefix(), "manifests/");
    }

    #[test]
    fn blobs_pass_through_untouched() {
        let codec = PlaintextCodec::new(&settings("p"));
        let key = codec.object_key("abc");
        let encoded = codec.encode_blob(&key, b"hello".to_vec()).unwrap();
        assert_eq!(encoded, b"hello");
        assert_eq!(codec.decode_blob(&key, encoded).unwrap(), b"hello");
        assert!(!codec.is_encrypted());
    }

    #[test]
    fn manifests_round_trip() {
        let codec = PlaintextCodec::new(&settings("p"));
        let key = codec.manifest_key("dev");
        let mut manifest = Manifest::new("dev", 42);
        manifest
            .entries
            .insert("Feed/a.md".to_string(), ManifestEntry::file("h1", 5, 10, 1));

        let encoded = codec.encode_manifest(&key, &manifest).unwrap();
        let decoded = codec.decode_manifest(&key, encoded).unwrap();
        assert_eq!(decoded.device_id, "dev");
        assert_eq!(decoded.entries["Feed/a.md"], ManifestEntry::file("h1", 5, 10, 1));
    }

    // ── Encrypted codec ────────────────────────────────────────────────────

    #[test]
    fn encrypted_object_keys_hide_the_content_hash_but_agree_across_devices() {
        let key = VaultKey::generate();
        let settings = settings("p");
        let a = EncryptedCodec::new(&settings, &key);
        let b = EncryptedCodec::new(&settings, &key);
        let hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

        let object = a.object_key(hash);
        assert_eq!(object, b.object_key(hash), "two devices must agree");
        assert!(object.starts_with("p/objects/"));
        assert!(!object.contains(hash), "the plaintext hash must not appear");
        assert!(a.is_encrypted());

        // A different vault produces different keys for the same content.
        let stranger = EncryptedCodec::new(&settings, &VaultKey::generate());
        assert_ne!(stranger.object_key(hash), object);
    }

    /// Garbage collection lists with an empty hash to mean "all objects"; if
    /// that became an HMAC, GC would list nothing and quietly never collect.
    #[test]
    fn the_empty_hash_still_names_the_objects_prefix() {
        let codec = EncryptedCodec::new(&settings("p"), &VaultKey::generate());
        assert_eq!(codec.object_key(""), "p/objects/");
    }

    #[test]
    fn encrypted_blobs_round_trip_and_are_bound_to_their_key() {
        let codec = EncryptedCodec::new(&settings("p"), &VaultKey::generate());
        let key = codec.object_key("abc");

        let stored = codec.encode_blob(&key, b"# Buy milk".to_vec()).unwrap();
        assert!(!stored.windows(4).any(|window| window == b"milk"));
        assert_eq!(codec.decode_blob(&key, stored.clone()).unwrap(), b"# Buy milk");

        // The same bytes filed under a different key are refused.
        assert!(codec.decode_blob(&codec.object_key("other"), stored).is_err());
    }

    #[test]
    fn encrypted_manifests_hide_paths_and_timestamps() {
        let codec = EncryptedCodec::new(&settings("p"), &VaultKey::generate());
        let key = codec.manifest_key("dev");
        let mut manifest = Manifest::new("dev", 42);
        manifest.entries.insert(
            "Personal/therapy-notes.md".to_string(),
            ManifestEntry::file("h1", 5, 10, 1),
        );

        let stored = codec.encode_manifest(&key, &manifest).unwrap();
        let raw = String::from_utf8_lossy(&stored);
        assert!(!raw.contains("therapy"), "filenames must not leak");
        assert!(!raw.contains("Personal"), "folder names must not leak");

        let decoded = codec.decode_manifest(&key, stored).unwrap();
        assert_eq!(
            decoded.entries["Personal/therapy-notes.md"],
            ManifestEntry::file("h1", 5, 10, 1)
        );
    }

    #[test]
    fn a_manifest_from_another_vault_is_refused_with_context() {
        let settings = settings("p");
        let mine = EncryptedCodec::new(&settings, &VaultKey::generate());
        let theirs = EncryptedCodec::new(&settings, &VaultKey::generate());
        let key = mine.manifest_key("dev");

        let stored = theirs.encode_manifest(&key, &Manifest::new("dev", 1)).unwrap();
        let error = mine.decode_manifest(&key, stored).unwrap_err();
        assert!(error.contains(&key), "the error should name the object: {error}");
    }

    /// Both codecs must agree on where the unencrypted markers live, because a
    /// device reads them before it knows which codec applies.
    #[test]
    fn the_plaintext_markers_sit_at_fixed_keys() {
        let settings = settings("type-notes/p1");
        assert_eq!(repo_key(&settings), "type-notes/p1/repo.json");
        assert_eq!(vault_key_object(&settings), "type-notes/p1/vault.json");
    }

    #[test]
    fn device_ids_come_back_out_of_manifest_keys() {
        assert_eq!(
            device_id_from_manifest_key("type-notes/p1/manifests/dev1.json"),
            Some("dev1")
        );
        assert_eq!(device_id_from_manifest_key("manifests/x.json"), Some("x"));
        assert_eq!(device_id_from_manifest_key("manifests/stray"), None);
    }
}
