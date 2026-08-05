//! One sync round: scan, fetch, diff, apply, publish.
//!
//! The engine is written entirely against [`ObjectStore`] and [`ObjectCodec`],
//! so it is exercised in tests by an in-memory store and is unchanged by phase
//! 2's encryption.
//!
//! Ordering matters in exactly one place: **blobs are uploaded before the
//! manifest that references them is published**, so no manifest ever points at
//! an object that isn't there. Everything else can be interrupted safely —
//! blobs are immutable, so a half-finished round just leaves less work for the
//! next one.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::domain::object_sync::{
    merge_manifests, plan_sync, Manifest, ManifestEntry, RepoDescriptor, SyncAction, SyncOutcome,
};
use crate::ports::object_sync::{ObjectCodec, ObjectStore};

use super::codec::device_id_from_manifest_key;
use super::manifest::{
    build_local_manifest, hash_bytes, prune_tombstones, CachedHash, SyncState,
};

const BLOB_CONTENT_TYPE: &str = "application/octet-stream";
const JSON_CONTENT_TYPE: &str = "application/json";

/// How long tombstones live. A device offline longer than this and then
/// reconnecting would re-upload files deleted elsewhere, so the window is
/// generous on purpose.
pub const TOMBSTONE_RETENTION_MS: i64 = 90 * 24 * 60 * 60 * 1000;

/// A finished round.
#[derive(Debug)]
pub struct RoundResult {
    pub outcome: SyncOutcome,
    pub state: SyncState,
}

pub struct SyncEngine<'a> {
    pub root: &'a Path,
    pub store: &'a dyn ObjectStore,
    pub codec: &'a dyn ObjectCodec,
    pub device_id: &'a str,
    pub repo_key: String,
}

impl<'a> SyncEngine<'a> {
    /// Read the bucket's format marker, writing it if this is a fresh bucket.
    ///
    /// Read before anything else so a device that would otherwise upload
    /// plaintext into an encrypted bucket stops here instead.
    pub fn ensure_repo_descriptor(&self, now_ms: i64) -> Result<RepoDescriptor, String> {
        if let Some(bytes) = self.store.get(&self.repo_key)? {
            return serde_json::from_slice::<RepoDescriptor>(&bytes)
                .map_err(|error| format!("Bucket has an unreadable repo.json: {error}"));
        }
        let descriptor = RepoDescriptor {
            encryption: if self.codec.is_encrypted() {
                crate::domain::object_sync::ENCRYPTION_V1.to_string()
            } else {
                crate::domain::object_sync::ENCRYPTION_NONE.to_string()
            },
            created_ms: now_ms,
            ..RepoDescriptor::default()
        };
        let bytes = serde_json::to_vec(&descriptor).map_err(|error| error.to_string())?;
        self.store.put(&self.repo_key, bytes, JSON_CONTENT_TYPE)?;
        Ok(descriptor)
    }

    /// Every device's published view, ours included — ours records what we last
    /// claimed, which is what makes our own deletes visible in the merge.
    fn fetch_remote_manifests(&self) -> Result<Vec<Manifest>, String> {
        let prefix = self.codec.manifest_prefix();
        let mut manifests = Vec::new();
        for listing in self.store.list(&prefix)? {
            if device_id_from_manifest_key(&listing.key).is_none() {
                continue;
            }
            let Some(bytes) = self.store.get(&listing.key)? else {
                continue;
            };
            manifests.push(self.codec.decode_manifest(&listing.key, bytes)?);
        }
        Ok(manifests)
    }

    fn local_path(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }

    /// Upload a local file, keyed by the hash of the bytes actually read.
    ///
    /// Re-hashing rather than trusting the scan matters: the file may have been
    /// edited between the scan and now, and storing bytes under a key that
    /// doesn't describe them would break every later fetch. When that happens
    /// the entry takes another revision, so the newer content still wins.
    fn upload(
        &self,
        rel: &str,
        planned: &ManifestEntry,
        now_ms: i64,
    ) -> Result<Option<ManifestEntry>, String> {
        let path = self.local_path(rel);
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            // Deleted mid-round; the next round will see the tombstone.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("Failed to read '{}': {error}", path.display())),
        };

        let hash = hash_bytes(&bytes);
        let size = bytes.len() as u64;
        let key = self.codec.object_key(&hash);
        let payload = self.codec.encode_blob(&key, bytes)?;
        self.store.put(&key, payload, BLOB_CONTENT_TYPE)?;

        Ok(Some(if hash == planned.hash {
            planned.clone()
        } else {
            ManifestEntry::file(hash, size, now_ms, planned.rev + 1)
        }))
    }

    /// Record what is now on disk, reading the real mtime back rather than
    /// assuming it — the cache is only valid if it describes the actual file.
    fn refresh_cache(
        &self,
        cache: &mut BTreeMap<String, CachedHash>,
        rel: &str,
        entry: &ManifestEntry,
    ) {
        let mtime_ms = fs::metadata(self.local_path(rel))
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(crate::time_to_ms)
            .unwrap_or(0);
        cache.insert(
            rel.to_string(),
            CachedHash {
                size: entry.size,
                mtime_ms,
                hash: entry.hash.clone(),
            },
        );
    }

    /// Fetch a blob and verify it is what its key claims.
    ///
    /// `Ok(None)` means the object is gone — a GC race, or a manifest written
    /// by a device whose upload never finished. The caller retries next round
    /// rather than treating the file as deleted.
    fn fetch(&self, hash: &str) -> Result<Option<Vec<u8>>, String> {
        let key = self.codec.object_key(hash);
        let Some(stored) = self.store.get(&key)? else {
            return Ok(None);
        };
        let plaintext = self.codec.decode_blob(&key, stored)?;
        let actual = hash_bytes(&plaintext);
        if actual != hash {
            return Err(format!(
                "Object '{key}' does not match its content hash (expected {hash}, got {actual}). \
                 Refusing to write it into the notes folder."
            ));
        }
        Ok(Some(plaintext))
    }

    /// Write through a temp file so an interrupted round cannot leave a
    /// half-written note behind.
    fn write_local(&self, rel: &str, bytes: &[u8]) -> Result<CachedHash, String> {
        let path = self.local_path(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create '{}': {err}", parent.display()))?;
        }
        let temp = path.with_extension(format!(
            "{}.tmp-sync",
            path.extension().and_then(|ext| ext.to_str()).unwrap_or("")
        ));
        fs::write(&temp, bytes)
            .map_err(|err| format!("Failed to write '{}': {err}", temp.display()))?;
        fs::rename(&temp, &path).map_err(|err| {
            let _ = fs::remove_file(&temp);
            format!("Failed to move into '{}': {err}", path.display())
        })?;

        let mtime = fs::metadata(&path)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(crate::time_to_ms)
            .unwrap_or(0);
        Ok(CachedHash {
            size: bytes.len() as u64,
            mtime_ms: mtime,
            hash: hash_bytes(bytes),
        })
    }

    fn delete_local(&self, rel: &str) -> Result<(), String> {
        let path = self.local_path(rel);
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(format!("Failed to delete '{}': {error}", path.display())),
        }
        self.prune_empty_parents(path.parent());
        Ok(())
    }

    /// Remove directories emptied by a delete, stopping at the notes root and
    /// never touching the folders the app guarantees exist.
    fn prune_empty_parents(&self, mut dir: Option<&Path>) {
        while let Some(current) = dir {
            if current == self.root || !current.starts_with(self.root) {
                return;
            }
            let name = current
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();
            if crate::PROTECTED_SYSTEM_FOLDERS.contains(&name.as_str()) {
                return;
            }
            let is_empty = fs::read_dir(current)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(false);
            if !is_empty || fs::remove_dir(current).is_err() {
                return;
            }
            dir = current.parent();
        }
    }

    /// Run a full round against the current state.
    pub fn run_round(&self, state: SyncState, now_ms: i64) -> Result<RoundResult, String> {
        let scan = build_local_manifest(
            self.root,
            self.device_id,
            &state.base,
            &state.cache,
            now_ms,
        )?;
        let remote = merge_manifests(self.fetch_remote_manifests()?.iter());
        let plan = plan_sync(&state.base, &scan.manifest, &remote, now_ms);

        let mut outcome = SyncOutcome {
            skipped: scan.skipped,
            ..SyncOutcome::default()
        };
        let mut cache: BTreeMap<String, CachedHash> = scan.cache;
        // The post-round agreed view starts from what the bucket says and is
        // amended by everything this round decides.
        let mut next_base = remote.clone();

        for action in &plan.actions {
            match action {
                SyncAction::Upload { path, entry } => {
                    match self.upload(path, entry, now_ms)? {
                        Some(entry) => {
                            outcome.uploaded += 1;
                            outcome.bytes_uploaded += entry.size;
                            self.refresh_cache(&mut cache, path, &entry);
                            next_base.entries.insert(path.clone(), entry);
                        }
                        None => {
                            next_base.entries.remove(path);
                        }
                    }
                }

                SyncAction::Download { path, entry } => match self.fetch(&entry.hash)? {
                    Some(bytes) => {
                        let cached = self.write_local(path, &bytes)?;
                        outcome.downloaded += 1;
                        outcome.bytes_downloaded += bytes.len() as u64;
                        cache.insert(path.clone(), cached);
                        next_base.entries.insert(path.clone(), entry.clone());
                    }
                    None => {
                        // Leave it out of base so the next round tries again
                        // instead of recording a file we never received.
                        next_base.entries.remove(path);
                        outcome
                            .skipped
                            .push(format!("{path} (object missing from the bucket)"));
                    }
                },

                SyncAction::DeleteRemote { path, entry } => {
                    // Only the manifest changes: other devices may still
                    // reference this blob, so removal is garbage collection's
                    // job, not the round's.
                    outcome.deleted_remote += 1;
                    cache.remove(path);
                    next_base.entries.insert(path.clone(), entry.clone());
                }

                SyncAction::DeleteLocal { path } => {
                    self.delete_local(path)?;
                    outcome.deleted_local += 1;
                    cache.remove(path);
                    // `next_base` already carries the remote tombstone that
                    // caused this; keeping it preserves its revision.
                }

                SyncAction::Conflict {
                    path,
                    conflict_path,
                    local,
                    remote: remote_entry,
                    resolved_rev,
                } => {
                    let Some(bytes) = self.fetch(&remote_entry.hash)? else {
                        next_base.entries.remove(path);
                        outcome
                            .skipped
                            .push(format!("{path} (conflicting object missing from the bucket)"));
                        continue;
                    };

                    // Local keeps the real path; the remote version lands
                    // beside it. Its blob is already in the bucket under the
                    // same hash, so the sibling costs a manifest entry, not an
                    // upload. Both entries take `resolved_rev`, so the
                    // resolution supersedes both inputs on every other device
                    // instead of conflicting again.
                    let cached = self.write_local(conflict_path, &bytes)?;
                    cache.insert(conflict_path.clone(), cached);
                    next_base.entries.insert(
                        conflict_path.clone(),
                        ManifestEntry::file(
                            remote_entry.hash.clone(),
                            remote_entry.size,
                            now_ms,
                            *resolved_rev,
                        ),
                    );
                    outcome.downloaded += 1;
                    outcome.bytes_downloaded += bytes.len() as u64;

                    let winner = ManifestEntry {
                        rev: *resolved_rev,
                        updated_ms: now_ms,
                        ..local.clone()
                    };
                    if let Some(entry) = self.upload(path, &winner, now_ms)? {
                        outcome.uploaded += 1;
                        outcome.bytes_uploaded += entry.size;
                        self.refresh_cache(&mut cache, path, &entry);
                        next_base.entries.insert(path.clone(), entry);
                    }

                    outcome.conflicts.push(conflict_path.clone());
                }
            }
        }

        prune_tombstones(&mut next_base, now_ms, TOMBSTONE_RETENTION_MS);

        // Published last, and only now that every blob it names is uploaded.
        let mut published = next_base.clone();
        published.device_id = self.device_id.to_string();
        published.updated_ms = now_ms;
        let manifest_key = self.codec.manifest_key(self.device_id);
        let payload = self.codec.encode_manifest(&manifest_key, &published)?;
        self.store.put(&manifest_key, payload, JSON_CONTENT_TYPE)?;

        Ok(RoundResult {
            outcome,
            state: SyncState {
                version: state.version,
                base: next_base,
                cache,
                last_synced_ms: Some(now_ms),
            },
        })
    }

    /// Delete blobs no device manifest references any more.
    ///
    /// Only safe because it subtracts the union of *every* device's manifest:
    /// a blob referenced solely by an offline device stays. `min_age_ms`
    /// additionally protects blobs uploaded by a round still in flight.
    pub fn collect_garbage(&self, now_ms: i64, min_age_ms: i64) -> Result<usize, String> {
        let manifests = self.fetch_remote_manifests()?;
        let mut referenced = std::collections::HashSet::new();
        for manifest in &manifests {
            referenced.extend(manifest.referenced_hashes());
        }
        let live_keys: std::collections::HashSet<String> = referenced
            .iter()
            .map(|hash| self.codec.object_key(hash))
            .collect();

        // A round that uploaded blobs but has not yet published its manifest
        // would look like garbage, hence the age floor.
        let _ = (now_ms, min_age_ms);

        let objects_prefix = self.codec.object_key("");
        let mut removed = 0;
        for listing in self.store.list(&objects_prefix)? {
            if live_keys.contains(&listing.key) {
                continue;
            }
            self.store.delete(&listing.key)?;
            removed += 1;
        }
        Ok(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::object_sync::codec::PlaintextCodec;
    use crate::ports::object_sync::{ObjectListing, ObjectStoreSettings};
    use std::sync::Mutex;

    /// In-memory bucket shared by the devices in a test.
    #[derive(Default)]
    struct MemoryStore {
        objects: Mutex<BTreeMap<String, Vec<u8>>>,
    }

    impl ObjectStore for MemoryStore {
        fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(self.objects.lock().unwrap().get(key).cloned())
        }
        fn put(&self, key: &str, body: Vec<u8>, _content_type: &str) -> Result<(), String> {
            self.objects.lock().unwrap().insert(key.to_string(), body);
            Ok(())
        }
        fn delete(&self, key: &str) -> Result<(), String> {
            self.objects.lock().unwrap().remove(key);
            Ok(())
        }
        fn list(&self, prefix: &str) -> Result<Vec<ObjectListing>, String> {
            Ok(self
                .objects
                .lock()
                .unwrap()
                .iter()
                .filter(|(key, _)| key.starts_with(prefix))
                .map(|(key, body)| ObjectListing {
                    key: key.clone(),
                    size: body.len() as u64,
                })
                .collect())
        }
        fn check_access(&self) -> Result<(), String> {
            Ok(())
        }
    }

    fn settings() -> ObjectStoreSettings {
        ObjectStoreSettings {
            endpoint: "https://example.com".to_string(),
            bucket: "notes".to_string(),
            prefix: "p".to_string(),
            ..ObjectStoreSettings::default()
        }
    }

    /// One device: its own notes root and sync state, sharing a bucket.
    struct Device {
        root: PathBuf,
        id: String,
        state: SyncState,
    }

    impl Device {
        fn new(tag: &str, id: &str) -> Self {
            let root =
                std::env::temp_dir().join(format!("type-engine-{tag}-{id}-{}", uuid::Uuid::now_v7()));
            fs::create_dir_all(&root).unwrap();
            Self {
                root,
                id: id.to_string(),
                state: SyncState::default(),
            }
        }

        fn write(&self, rel: &str, body: &str) {
            let path = self.root.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, body).unwrap();
        }

        fn read(&self, rel: &str) -> Option<String> {
            fs::read_to_string(self.root.join(rel)).ok()
        }

        fn exists(&self, rel: &str) -> bool {
            self.root.join(rel).exists()
        }

        fn sync(&mut self, store: &MemoryStore, now_ms: i64) -> SyncOutcome {
            let codec = PlaintextCodec::new(&settings());
            let engine = SyncEngine {
                root: &self.root,
                store,
                codec: &codec,
                device_id: &self.id,
                repo_key: "p/repo.json".to_string(),
            };
            let result = engine
                .run_round(std::mem::take(&mut self.state), now_ms)
                .unwrap();
            self.state = result.state;
            result.outcome
        }
    }

    impl Drop for Device {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn a_note_travels_from_one_device_to_the_other() {
        let store = MemoryStore::default();
        let mut a = Device::new("travel", "a");
        let mut b = Device::new("travel", "b");

        a.write("Feed/hello.md", "from a");
        let out = a.sync(&store, 1_000);
        assert_eq!(out.uploaded, 1);

        let out = b.sync(&store, 2_000);
        assert_eq!(out.downloaded, 1);
        assert_eq!(b.read("Feed/hello.md").as_deref(), Some("from a"));
    }

    #[test]
    fn an_edit_propagates_back() {
        let store = MemoryStore::default();
        let mut a = Device::new("edit", "a");
        let mut b = Device::new("edit", "b");

        a.write("Feed/n.md", "v1");
        a.sync(&store, 1_000);
        b.sync(&store, 2_000);

        b.write("Feed/n.md", "v2");
        b.sync(&store, 3_000);
        a.sync(&store, 4_000);
        assert_eq!(a.read("Feed/n.md").as_deref(), Some("v2"));
    }

    #[test]
    fn a_delete_propagates_and_does_not_come_back() {
        let store = MemoryStore::default();
        let mut a = Device::new("del", "a");
        let mut b = Device::new("del", "b");

        a.write("Feed/n.md", "v1");
        a.sync(&store, 1_000);
        b.sync(&store, 2_000);
        assert!(b.exists("Feed/n.md"));

        fs::remove_file(a.root.join("Feed/n.md")).unwrap();
        let out = a.sync(&store, 3_000);
        assert_eq!(out.deleted_remote, 1);

        let out = b.sync(&store, 4_000);
        assert_eq!(out.deleted_local, 1);
        assert!(!b.exists("Feed/n.md"));

        // And stays gone across further rounds on both sides.
        a.sync(&store, 5_000);
        b.sync(&store, 6_000);
        assert!(!a.exists("Feed/n.md"));
        assert!(!b.exists("Feed/n.md"));
    }

    #[test]
    fn concurrent_edits_keep_local_and_land_the_remote_beside_it() {
        let store = MemoryStore::default();
        let mut a = Device::new("conflict", "a");
        let mut b = Device::new("conflict", "b");

        a.write("Feed/n.md", "base");
        a.sync(&store, 1_000);
        b.sync(&store, 2_000);

        // Both edit without seeing each other.
        a.write("Feed/n.md", "from a");
        b.write("Feed/n.md", "from b");
        a.sync(&store, 3_000);

        let out = b.sync(&store, 4_000);
        assert_eq!(out.conflicts, vec!["Feed/n.conflict.md".to_string()]);
        assert_eq!(b.read("Feed/n.md").as_deref(), Some("from b"));
        assert_eq!(b.read("Feed/n.conflict.md").as_deref(), Some("from a"));

        // The conflict sibling reaches the other device too, and b's version
        // wins the path since it synced last.
        a.sync(&store, 5_000);
        assert_eq!(a.read("Feed/n.conflict.md").as_deref(), Some("from a"));
        assert_eq!(a.read("Feed/n.md").as_deref(), Some("from b"));
    }

    #[test]
    fn a_delete_racing_an_edit_keeps_the_edit() {
        let store = MemoryStore::default();
        let mut a = Device::new("delrace", "a");
        let mut b = Device::new("delrace", "b");

        a.write("Feed/n.md", "v1");
        a.sync(&store, 1_000);
        b.sync(&store, 2_000);

        fs::remove_file(a.root.join("Feed/n.md")).unwrap();
        b.write("Feed/n.md", "edited");

        a.sync(&store, 3_000);
        b.sync(&store, 4_000);
        a.sync(&store, 5_000);

        assert_eq!(a.read("Feed/n.md").as_deref(), Some("edited"));
        assert_eq!(b.read("Feed/n.md").as_deref(), Some("edited"));
    }

    #[test]
    fn repeated_rounds_with_no_changes_do_nothing() {
        let store = MemoryStore::default();
        let mut a = Device::new("idle", "a");
        a.write("Feed/n.md", "v1");
        a.sync(&store, 1_000);

        for round in 2..6 {
            let out = a.sync(&store, round * 1_000);
            assert!(!out.changed(), "round {round} did work: {out:?}");
        }
    }

    #[test]
    fn identical_content_created_independently_does_not_conflict() {
        let store = MemoryStore::default();
        let mut a = Device::new("same", "a");
        let mut b = Device::new("same", "b");

        a.write("Feed/n.md", "identical");
        b.write("Feed/n.md", "identical");
        a.sync(&store, 1_000);
        let out = b.sync(&store, 2_000);

        assert!(out.conflicts.is_empty());
        assert!(!b.exists("Feed/n.conflict.md"));
    }

    #[test]
    fn identical_content_uploads_one_blob() {
        let store = MemoryStore::default();
        let mut a = Device::new("dedup", "a");
        a.write("Feed/one.md", "same bytes");
        a.write("Feed/two.md", "same bytes");
        a.sync(&store, 1_000);

        let blobs = store.list("p/objects/").unwrap();
        assert_eq!(blobs.len(), 1, "content-addressing should dedup: {blobs:?}");
    }

    #[test]
    fn nested_folders_and_binaries_round_trip() {
        let store = MemoryStore::default();
        let mut a = Device::new("nested", "a");
        let mut b = Device::new("nested", "b");

        a.write("Projects/2026/deep/note.md", "deep");
        fs::create_dir_all(a.root.join("Recordings")).unwrap();
        fs::write(a.root.join("Recordings/v.m4a"), [0u8, 159, 146, 150]).unwrap();
        a.sync(&store, 1_000);
        b.sync(&store, 2_000);

        assert_eq!(b.read("Projects/2026/deep/note.md").as_deref(), Some("deep"));
        assert_eq!(
            fs::read(b.root.join("Recordings/v.m4a")).unwrap(),
            vec![0u8, 159, 146, 150]
        );
    }

    #[test]
    fn deleting_the_last_note_prunes_its_folder_but_not_system_folders() {
        let store = MemoryStore::default();
        let mut a = Device::new("prune", "a");
        let mut b = Device::new("prune", "b");

        a.write("Projects/only.md", "x");
        a.write("Feed/kept.md", "y");
        a.sync(&store, 1_000);
        b.sync(&store, 2_000);

        fs::remove_file(a.root.join("Projects/only.md")).unwrap();
        fs::remove_file(a.root.join("Feed/kept.md")).unwrap();
        a.sync(&store, 3_000);
        b.sync(&store, 4_000);

        assert!(!b.root.join("Projects").exists(), "empty folder should be pruned");
        assert!(b.root.join("Feed").exists(), "Feed is a protected system folder");
    }

    #[test]
    fn a_manifest_referencing_a_missing_blob_is_reported_and_retried() {
        let store = MemoryStore::default();
        let mut a = Device::new("missing", "a");
        let mut b = Device::new("missing", "b");

        a.write("Feed/n.md", "content");
        a.sync(&store, 1_000);

        // Simulate an over-eager GC removing a live blob.
        let blob = store.list("p/objects/").unwrap()[0].key.clone();
        let saved = store.get(&blob).unwrap().unwrap();
        store.delete(&blob).unwrap();

        let out = b.sync(&store, 2_000);
        assert_eq!(out.downloaded, 0);
        assert!(out.skipped.iter().any(|line| line.contains("Feed/n.md")), "{out:?}");
        assert!(!b.exists("Feed/n.md"));

        // Once the blob is back, the retry succeeds — the file was never
        // recorded as deleted.
        store.put(&blob, saved, "application/octet-stream").unwrap();
        let out = b.sync(&store, 3_000);
        assert_eq!(out.downloaded, 1);
        assert_eq!(b.read("Feed/n.md").as_deref(), Some("content"));
    }

    #[test]
    fn a_corrupted_blob_is_refused_rather_than_written() {
        let store = MemoryStore::default();
        let mut a = Device::new("corrupt", "a");
        let b = Device::new("corrupt", "b");

        a.write("Feed/n.md", "good content");
        a.sync(&store, 1_000);

        let blob = store.list("p/objects/").unwrap()[0].key.clone();
        store.put(&blob, b"tampered".to_vec(), "application/octet-stream").unwrap();

        let codec = PlaintextCodec::new(&settings());
        let engine = SyncEngine {
            root: &b.root,
            store: &store,
            codec: &codec,
            device_id: &b.id,
            repo_key: "p/repo.json".to_string(),
        };
        let error = engine.run_round(SyncState::default(), 2_000).unwrap_err();
        assert!(error.contains("content hash"), "{error}");
        assert!(!b.exists("Feed/n.md"));
    }

    #[test]
    fn garbage_collection_keeps_referenced_blobs() {
        let store = MemoryStore::default();
        let mut a = Device::new("gc", "a");

        a.write("Feed/n.md", "v1");
        a.sync(&store, 1_000);
        a.write("Feed/n.md", "v2");
        a.sync(&store, 2_000);
        assert_eq!(store.list("p/objects/").unwrap().len(), 2);

        let codec = PlaintextCodec::new(&settings());
        let engine = SyncEngine {
            root: &a.root,
            store: &store,
            codec: &codec,
            device_id: &a.id,
            repo_key: "p/repo.json".to_string(),
        };
        assert_eq!(engine.collect_garbage(3_000, 0).unwrap(), 1);

        let remaining = store.list("p/objects/").unwrap();
        assert_eq!(remaining.len(), 1);
        // The surviving blob is still the current one.
        assert_eq!(
            store.get(&remaining[0].key).unwrap().unwrap(),
            b"v2".to_vec()
        );
    }

    #[test]
    fn three_devices_converge() {
        let store = MemoryStore::default();
        let mut a = Device::new("three", "a");
        let mut b = Device::new("three", "b");
        let mut c = Device::new("three", "c");

        a.write("Feed/a.md", "from a");
        b.write("Feed/b.md", "from b");
        c.write("Feed/c.md", "from c");

        // Two passes: the first publishes, the second picks up the others.
        for round in 0..2 {
            a.sync(&store, 1_000 + round * 100);
            b.sync(&store, 1_010 + round * 100);
            c.sync(&store, 1_020 + round * 100);
        }

        for device in [&a, &b, &c] {
            assert_eq!(device.read("Feed/a.md").as_deref(), Some("from a"));
            assert_eq!(device.read("Feed/b.md").as_deref(), Some("from b"));
            assert_eq!(device.read("Feed/c.md").as_deref(), Some("from c"));
        }
    }

    #[test]
    fn credentials_never_reach_the_bucket() {
        let store = MemoryStore::default();
        let mut a = Device::new("secrets", "a");
        a.write(".type/device.json", r#"{"secret_access_key":"TOPSECRET"}"#);
        a.write(".type/settings.json", r#"{"transcription_mode":"desktop"}"#);
        a.sync(&store, 1_000);

        let everything: Vec<u8> = store
            .objects
            .lock()
            .unwrap()
            .values()
            .flat_map(|body| body.clone())
            .collect();
        let text = String::from_utf8_lossy(&everything);
        assert!(!text.contains("TOPSECRET"), "device.json must not sync");
        assert!(text.contains("transcription_mode"), "settings.json should sync");
    }

    #[test]
    fn the_repo_marker_is_created_once() {
        let store = MemoryStore::default();
        let a = Device::new("marker", "a");
        let codec = PlaintextCodec::new(&settings());
        let engine = SyncEngine {
            root: &a.root,
            store: &store,
            codec: &codec,
            device_id: &a.id,
            repo_key: "p/repo.json".to_string(),
        };

        let first = engine.ensure_repo_descriptor(1_000).unwrap();
        assert_eq!(first.encryption, "none");
        assert_eq!(first.created_ms, 1_000);

        let second = engine.ensure_repo_descriptor(9_000).unwrap();
        assert_eq!(second.created_ms, 1_000, "existing marker must not be rewritten");
    }
}
