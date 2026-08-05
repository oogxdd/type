//! Phase-1 codec: keys derived straight from the content hash, payloads stored
//! as-is.
//!
//! This is the seam phase 2 replaces. Everything above it — the engine, the
//! scheduler, the manifests — is written against [`ObjectCodec`] and does not
//! know whether bytes are encrypted.

use crate::domain::object_sync::Manifest;
use crate::ports::object_sync::{ObjectCodec, ObjectStoreSettings};

pub const OBJECTS_SEGMENT: &str = "objects";
pub const MANIFESTS_SEGMENT: &str = "manifests";
pub const REPO_OBJECT: &str = "repo.json";

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

/// The repo marker's key, which is the same regardless of codec — a device has
/// to read it *before* it knows whether the bucket is encrypted.
pub fn repo_key(settings: &ObjectStoreSettings) -> String {
    settings.key_for(REPO_OBJECT)
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
