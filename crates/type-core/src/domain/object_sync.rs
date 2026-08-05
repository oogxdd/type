//! Object-storage sync domain types.
//!
//! Framework-free: manifests, the three-way diff between local/base/remote, and
//! the plan a sync round executes. Nothing here touches the filesystem or the
//! network — [`crate::adapters::object_sync`] does that.
//!
//! See `docs/OBJECT_SYNC.md` for the design these types encode.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

/// Bucket layout version. Bumped only for breaking on-disk format changes.
pub const OBJECT_SYNC_FORMAT_VERSION: u32 = 1;

/// Suffix used for the "remote won a conflict" sibling file, matching the
/// `.conflict.md` scheme the git transport already produces.
pub const CONFLICT_SUFFIX: &str = "conflict";

// ── Manifest ───────────────────────────────────────────────────────────────────

/// One path's state in a device manifest.
///
/// A live entry carries `hash`/`size`; a tombstone carries only `deleted_ms`.
/// The two are distinguished by [`ManifestEntry::is_deleted`] rather than an
/// enum so the JSON stays flat and forward-compatible.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct ManifestEntry {
    /// Hex SHA-256 of the file's plaintext bytes. Empty for a tombstone.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub hash: String,
    #[serde(default, skip_serializing_if = "is_zero_u64")]
    pub size: u64,
    /// Per-path revision, incremented by whichever device changes the content.
    ///
    /// This — not the timestamp — is what orders writes. A device that edits a
    /// file it has already synced necessarily produces `base.rev + 1`, so its
    /// version wins without the two devices' clocks having to agree. Equal
    /// revisions mean the edits were genuinely concurrent, which is exactly the
    /// case [`plan_sync`] reports as a conflict.
    #[serde(default)]
    pub rev: u64,
    /// When the device that made this change observed it. Only a tiebreak.
    #[serde(default)]
    pub updated_ms: i64,
    /// Set when the path was deleted; mutually exclusive with `hash`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_ms: Option<i64>,
}

fn is_zero_u64(value: &u64) -> bool {
    *value == 0
}

impl ManifestEntry {
    pub fn file(hash: impl Into<String>, size: u64, updated_ms: i64, rev: u64) -> Self {
        Self {
            hash: hash.into(),
            size,
            rev,
            updated_ms,
            deleted_ms: None,
        }
    }

    pub fn tombstone(deleted_ms: i64, rev: u64) -> Self {
        Self {
            hash: String::new(),
            size: 0,
            rev,
            updated_ms: deleted_ms,
            deleted_ms: Some(deleted_ms),
        }
    }

    pub fn is_deleted(&self) -> bool {
        self.deleted_ms.is_some() || self.hash.is_empty()
    }

    /// The instant this entry represents, used only to break revision ties.
    pub fn stamp(&self) -> i64 {
        self.deleted_ms.unwrap_or(self.updated_ms)
    }
}

/// One device's view of the notes root, as published to the bucket.
///
/// Each device writes only its own manifest, which is what makes concurrent
/// syncs safe without conditional writes — see `docs/OBJECT_SYNC.md`.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Manifest {
    #[serde(default = "default_format_version")]
    pub version: u32,
    #[serde(default)]
    pub device_id: String,
    #[serde(default)]
    pub updated_ms: i64,
    /// Relative POSIX path → entry. `BTreeMap` so serialization is stable and
    /// two devices with the same content produce byte-identical manifests.
    #[serde(default)]
    pub entries: BTreeMap<String, ManifestEntry>,
}

fn default_format_version() -> u32 {
    OBJECT_SYNC_FORMAT_VERSION
}

impl Default for Manifest {
    fn default() -> Self {
        Self {
            version: OBJECT_SYNC_FORMAT_VERSION,
            device_id: String::new(),
            updated_ms: 0,
            entries: BTreeMap::new(),
        }
    }
}

impl Manifest {
    pub fn new(device_id: impl Into<String>, updated_ms: i64) -> Self {
        Self {
            version: OBJECT_SYNC_FORMAT_VERSION,
            device_id: device_id.into(),
            updated_ms,
            entries: BTreeMap::new(),
        }
    }

    /// Hashes of every live entry — the reachability set garbage collection
    /// subtracts from the blobs actually present in the bucket.
    pub fn referenced_hashes(&self) -> HashSet<String> {
        self.entries
            .values()
            .filter(|entry| !entry.is_deleted())
            .map(|entry| entry.hash.clone())
            .collect()
    }
}

/// Merge every device manifest into one view of "what the bucket says now".
///
/// Per path, the highest revision wins, because a higher revision means that
/// device had already seen the lower one. Only when revisions are equal — real
/// concurrency — do the tiebreaks apply: a live entry beats a tombstone
/// (deletion never wins a race it didn't clearly win), then the later stamp,
/// then the greater hash. Every device computes the same answer from the same
/// inputs, with no dependence on their clocks agreeing.
pub fn merge_manifests<'a>(manifests: impl IntoIterator<Item = &'a Manifest>) -> Manifest {
    let mut merged = Manifest::default();
    for manifest in manifests {
        if manifest.updated_ms > merged.updated_ms {
            merged.updated_ms = manifest.updated_ms;
        }
        for (path, entry) in &manifest.entries {
            match merged.entries.get(path) {
                Some(existing) if !supersedes(entry, existing) => {}
                _ => {
                    merged.entries.insert(path.clone(), entry.clone());
                }
            }
        }
    }
    merged
}

/// Does `candidate` win over `existing` in the merge?
fn supersedes(candidate: &ManifestEntry, existing: &ManifestEntry) -> bool {
    use std::cmp::Ordering;

    match candidate.rev.cmp(&existing.rev) {
        Ordering::Greater => return true,
        Ordering::Less => return false,
        Ordering::Equal => {}
    }
    match (candidate.is_deleted(), existing.is_deleted()) {
        (false, true) => return true,
        (true, false) => return false,
        _ => {}
    }
    match candidate.stamp().cmp(&existing.stamp()) {
        Ordering::Greater => true,
        Ordering::Less => false,
        Ordering::Equal => candidate.hash > existing.hash,
    }
}

/// Marker object at `<prefix>/repo.json` describing what a bucket holds.
///
/// Read before every round so a device notices that another one turned
/// encryption on, rather than uploading plaintext into an encrypted bucket.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RepoDescriptor {
    #[serde(default = "default_format_version")]
    pub version: u32,
    /// `"none"` in phase 1, `"v1"` once end-to-end encryption is enabled.
    #[serde(default = "default_encryption")]
    pub encryption: String,
    #[serde(default)]
    pub created_ms: i64,
}

fn default_encryption() -> String {
    ENCRYPTION_NONE.to_string()
}

pub const ENCRYPTION_NONE: &str = "none";
pub const ENCRYPTION_V1: &str = "v1";

impl Default for RepoDescriptor {
    fn default() -> Self {
        Self {
            version: OBJECT_SYNC_FORMAT_VERSION,
            encryption: default_encryption(),
            created_ms: 0,
        }
    }
}

impl RepoDescriptor {
    pub fn is_encrypted(&self) -> bool {
        self.encryption == ENCRYPTION_V1
    }
}

// ── Diff ───────────────────────────────────────────────────────────────────────

/// What a sync round decided to do about one path.
#[derive(Clone, Debug, PartialEq)]
pub enum SyncAction {
    /// Local content is newer — publish it.
    Upload { path: String, entry: ManifestEntry },
    /// Remote content is newer — write it to disk.
    Download { path: String, entry: ManifestEntry },
    /// Deleted locally; publish the tombstone.
    DeleteRemote { path: String, entry: ManifestEntry },
    /// Deleted remotely; remove the local file.
    DeleteLocal { path: String },
    /// Both sides changed. Keep local, land the remote copy beside it.
    Conflict {
        path: String,
        conflict_path: String,
        local: ManifestEntry,
        remote: ManifestEntry,
        /// Revision to publish for the resolution, above both inputs so the
        /// outcome supersedes them everywhere instead of re-conflicting.
        resolved_rev: u64,
    },
}

impl SyncAction {
    pub fn path(&self) -> &str {
        match self {
            SyncAction::Upload { path, .. }
            | SyncAction::Download { path, .. }
            | SyncAction::DeleteRemote { path, .. }
            | SyncAction::DeleteLocal { path }
            | SyncAction::Conflict { path, .. } => path,
        }
    }
}

/// The full set of actions for one round, ordered for stable execution.
#[derive(Clone, Debug, Default)]
pub struct SyncPlan {
    pub actions: Vec<SyncAction>,
}

impl SyncPlan {
    pub fn is_empty(&self) -> bool {
        self.actions.is_empty()
    }
}

/// Compute the three-way diff.
///
/// `base` is the merged remote view as of our last successful round; `local` is
/// a fresh filesystem scan; `remote` is the merge of every device manifest in
/// the bucket right now. A path changed on a side when that side's entry
/// differs from `base`.
pub fn plan_sync(
    base: &Manifest,
    local: &Manifest,
    remote: &Manifest,
    now_ms: i64,
) -> SyncPlan {
    let mut paths: Vec<&String> = base
        .entries
        .keys()
        .chain(local.entries.keys())
        .chain(remote.entries.keys())
        .collect();
    paths.sort_unstable();
    paths.dedup();

    let mut actions = Vec::new();
    for path in paths {
        let base_entry = base.entries.get(path);
        let local_entry = local.entries.get(path);
        let remote_entry = remote.entries.get(path);

        let local_changed = differs(local_entry, base_entry);
        let remote_changed = differs(remote_entry, base_entry);

        if !local_changed && !remote_changed {
            continue;
        }

        match (local_changed, remote_changed) {
            (true, false) => {
                if let Some(action) = push_local(path, local_entry, now_ms) {
                    actions.push(action);
                }
            }
            (false, true) => {
                if let Some(action) = pull_remote(path, remote_entry) {
                    actions.push(action);
                }
            }
            (true, true) => {
                if let Some(action) = reconcile(path, local_entry, remote_entry, now_ms) {
                    actions.push(action);
                }
            }
            (false, false) => unreachable!("handled above"),
        }
    }

    SyncPlan { actions }
}

/// Treat "absent" and "tombstoned" as the same state, so a path we never knew
/// about and one we deleted long ago don't read as a change.
fn effective_hash(entry: Option<&ManifestEntry>) -> Option<&str> {
    match entry {
        Some(entry) if !entry.is_deleted() => Some(entry.hash.as_str()),
        _ => None,
    }
}

fn differs(entry: Option<&ManifestEntry>, base: Option<&ManifestEntry>) -> bool {
    effective_hash(entry) != effective_hash(base)
}

fn push_local(path: &str, local: Option<&ManifestEntry>, now_ms: i64) -> Option<SyncAction> {
    match local {
        Some(entry) if !entry.is_deleted() => Some(SyncAction::Upload {
            path: path.to_string(),
            entry: entry.clone(),
        }),
        _ => Some(SyncAction::DeleteRemote {
            path: path.to_string(),
            entry: local
                .cloned()
                .unwrap_or_else(|| ManifestEntry::tombstone(now_ms, 1)),
        }),
    }
}

fn pull_remote(path: &str, remote: Option<&ManifestEntry>) -> Option<SyncAction> {
    match remote {
        Some(entry) if !entry.is_deleted() => Some(SyncAction::Download {
            path: path.to_string(),
            entry: entry.clone(),
        }),
        _ => Some(SyncAction::DeleteLocal {
            path: path.to_string(),
        }),
    }
}

/// Both sides moved. Deletion always loses against a concurrent edit: the worst
/// case becomes "delete it twice" rather than "it's gone".
fn reconcile(
    path: &str,
    local: Option<&ManifestEntry>,
    remote: Option<&ManifestEntry>,
    now_ms: i64,
) -> Option<SyncAction> {
    let local_live = local.filter(|entry| !entry.is_deleted());
    let remote_live = remote.filter(|entry| !entry.is_deleted());

    match (local_live, remote_live) {
        // Converged on the same content independently — nothing to move.
        (Some(l), Some(r)) if l.hash == r.hash => None,
        (Some(l), Some(r)) => Some(SyncAction::Conflict {
            path: path.to_string(),
            conflict_path: conflict_path_for(path),
            local: l.clone(),
            remote: r.clone(),
            resolved_rev: l.rev.max(r.rev) + 1,
        }),
        // Deleted here, edited there → the edit wins, bring it back.
        (None, Some(r)) => Some(SyncAction::Download {
            path: path.to_string(),
            entry: r.clone(),
        }),
        // Edited here, deleted there → the edit wins, republish it.
        (Some(l), None) => Some(SyncAction::Upload {
            path: path.to_string(),
            entry: l.clone(),
        }),
        // Both deleted; agree and record whichever tombstone ranks higher so
        // the revision keeps climbing.
        (None, None) => Some(SyncAction::DeleteRemote {
            path: path.to_string(),
            entry: match (local, remote) {
                (Some(l), Some(r)) if supersedes(r, l) => r.clone(),
                (Some(l), _) => l.clone(),
                (None, Some(r)) => r.clone(),
                (None, None) => ManifestEntry::tombstone(now_ms, 1),
            },
        }),
    }
}

/// `Feed/note.md` → `Feed/note.conflict.md`, `notes/data` → `notes/data.conflict`.
///
/// Mirrors the git transport's conflict siblings so users see one convention.
pub fn conflict_path_for(path: &str) -> String {
    match path.rsplit_once('.') {
        // Only treat the tail as an extension when it looks like one — a dot in
        // a folder name ("v1.2/notes") must not swallow the path.
        Some((stem, ext)) if !stem.is_empty() && !ext.contains('/') && !ext.is_empty() => {
            format!("{stem}.{CONFLICT_SUFFIX}.{ext}")
        }
        _ => format!("{path}.{CONFLICT_SUFFIX}"),
    }
}

// ── Round outcome ──────────────────────────────────────────────────────────────

/// What a completed round did, for the UI and the logs.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SyncOutcome {
    pub uploaded: usize,
    pub downloaded: usize,
    pub deleted_local: usize,
    pub deleted_remote: usize,
    pub conflicts: Vec<String>,
    /// Files the round refused to upload, with the reason. Never silent — a
    /// skipped file that looked synced would be the worst outcome here.
    #[serde(default)]
    pub skipped: Vec<String>,
    pub bytes_uploaded: u64,
    pub bytes_downloaded: u64,
}

impl SyncOutcome {
    pub fn changed(&self) -> bool {
        self.uploaded > 0
            || self.downloaded > 0
            || self.deleted_local > 0
            || self.deleted_remote > 0
    }
}

/// Everything a shell needs to render sync state.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ObjectSyncStatus {
    pub configured: bool,
    pub encrypted: bool,
    /// Set when the bucket is encrypted but this device has no vault key yet.
    pub needs_passphrase: bool,
    pub syncing: bool,
    pub pending: bool,
    pub last_synced_ms: Option<i64>,
    pub last_error: Option<String>,
    pub last_outcome: Option<SyncOutcome>,
    pub device_id: String,
    pub bucket: String,
    pub prefix: String,
    pub endpoint: String,
    pub tracked_files: usize,
}

/// Convert a manifest into the map form the engine indexes by path.
pub fn entries_by_path(manifest: &Manifest) -> HashMap<&str, &ManifestEntry> {
    manifest
        .entries
        .iter()
        .map(|(path, entry)| (path.as_str(), entry))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(hash: &str, stamp: i64) -> ManifestEntry {
        ManifestEntry::file(hash, hash.len() as u64, stamp, 1)
    }

    /// A file entry at an explicit revision.
    fn rev(hash: &str, stamp: i64, rev: u64) -> ManifestEntry {
        ManifestEntry::file(hash, hash.len() as u64, stamp, rev)
    }

    fn manifest(device: &str, entries: &[(&str, ManifestEntry)]) -> Manifest {
        let mut manifest = Manifest::new(device, 0);
        for (path, entry) in entries {
            manifest.updated_ms = manifest.updated_ms.max(entry.stamp());
            manifest.entries.insert((*path).to_string(), entry.clone());
        }
        manifest
    }

    #[test]
    fn untouched_paths_produce_no_actions() {
        let base = manifest("base", &[("Feed/a.md", file("h1", 10))]);
        let plan = plan_sync(&base, &base.clone(), &base.clone(), 100);
        assert!(plan.is_empty());
    }

    #[test]
    fn local_only_change_uploads_and_remote_only_change_downloads() {
        let base = manifest("d", &[("a.md", file("h1", 10)), ("b.md", file("h1", 10))]);
        let local = manifest("d", &[("a.md", file("h2", 20)), ("b.md", file("h1", 10))]);
        let remote = manifest("d", &[("a.md", file("h1", 10)), ("b.md", file("h3", 30))]);

        let plan = plan_sync(&base, &local, &remote, 100);
        assert_eq!(
            plan.actions,
            vec![
                SyncAction::Upload {
                    path: "a.md".to_string(),
                    entry: file("h2", 20),
                },
                SyncAction::Download {
                    path: "b.md".to_string(),
                    entry: file("h3", 30),
                },
            ]
        );
    }

    #[test]
    fn concurrent_edits_conflict_and_keep_both_sides() {
        let base = manifest("d", &[("Feed/n.md", file("h1", 10))]);
        let local = manifest("d", &[("Feed/n.md", file("h2", 20))]);
        let remote = manifest("d", &[("Feed/n.md", file("h3", 30))]);

        let plan = plan_sync(&base, &local, &remote, 100);
        assert_eq!(
            plan.actions,
            vec![SyncAction::Conflict {
                path: "Feed/n.md".to_string(),
                conflict_path: "Feed/n.conflict.md".to_string(),
                local: file("h2", 20),
                remote: file("h3", 30),
                resolved_rev: 2,
            }]
        );
    }

    #[test]
    fn converging_on_identical_content_is_not_a_conflict() {
        let base = manifest("d", &[("n.md", file("h1", 10))]);
        let same = manifest("d", &[("n.md", file("h2", 20))]);
        let plan = plan_sync(&base, &same, &same.clone(), 100);
        assert!(plan.is_empty());
    }

    #[test]
    fn deletion_loses_against_a_concurrent_edit_in_both_directions() {
        let base = manifest("d", &[("n.md", file("h1", 10))]);

        // Deleted here, edited there → comes back.
        let deleted = manifest("d", &[("n.md", ManifestEntry::tombstone(20, 2))]);
        let edited = manifest("d", &[("n.md", file("h2", 30))]);
        let plan = plan_sync(&base, &deleted, &edited, 100);
        assert_eq!(
            plan.actions,
            vec![SyncAction::Download {
                path: "n.md".to_string(),
                entry: file("h2", 30),
            }]
        );

        // Edited here, deleted there → republished.
        let plan = plan_sync(&base, &edited, &deleted, 100);
        assert_eq!(
            plan.actions,
            vec![SyncAction::Upload {
                path: "n.md".to_string(),
                entry: file("h2", 30),
            }]
        );
    }

    #[test]
    fn one_sided_deletes_propagate() {
        let base = manifest("d", &[("a.md", file("h1", 10)), ("b.md", file("h1", 10))]);
        let local = manifest(
            "d",
            &[("a.md", ManifestEntry::tombstone(20, 2)), ("b.md", file("h1", 10))],
        );
        let remote = manifest(
            "d",
            &[("a.md", file("h1", 10)), ("b.md", ManifestEntry::tombstone(30, 2))],
        );

        let plan = plan_sync(&base, &local, &remote, 100);
        assert_eq!(
            plan.actions,
            vec![
                SyncAction::DeleteRemote {
                    path: "a.md".to_string(),
                    entry: ManifestEntry::tombstone(20, 2),
                },
                SyncAction::DeleteLocal {
                    path: "b.md".to_string(),
                },
            ]
        );
    }

    #[test]
    fn a_brand_new_local_file_uploads() {
        let base = Manifest::default();
        let local = manifest("d", &[("new.md", file("h1", 10))]);
        let plan = plan_sync(&base, &local, &Manifest::default(), 100);
        assert_eq!(
            plan.actions,
            vec![SyncAction::Upload {
                path: "new.md".to_string(),
                entry: file("h1", 10),
            }]
        );
    }

    #[test]
    fn merge_picks_the_latest_write_per_path() {
        let a = manifest("a", &[("n.md", file("h1", 10)), ("only-a.md", file("x", 5))]);
        let b = manifest("b", &[("n.md", file("h2", 20))]);

        let merged = merge_manifests([&a, &b]);
        assert_eq!(merged.entries["n.md"], file("h2", 20));
        assert_eq!(merged.entries["only-a.md"], file("x", 5));
        assert_eq!(merged.updated_ms, 20);

        // Order of manifests must not change the answer.
        let flipped = merge_manifests([&b, &a]);
        assert_eq!(flipped.entries, merged.entries);
    }

    /// The reason revisions exist. Device clocks disagree, and mtimes are
    /// coarse, so a genuinely newer edit can carry an older-looking stamp.
    /// Causality — "this device had already seen that version" — must win.
    #[test]
    fn a_higher_revision_beats_a_later_timestamp() {
        let stale_clock = manifest("b", &[("n.md", rev("newer", 5, 2))]);
        let fast_clock = manifest("a", &[("n.md", rev("older", 9_999, 1))]);

        let merged = merge_manifests([&fast_clock, &stale_clock]);
        assert_eq!(merged.entries["n.md"].hash, "newer");
        assert_eq!(merge_manifests([&stale_clock, &fast_clock]).entries["n.md"].hash, "newer");
    }

    #[test]
    fn equal_revisions_fall_back_to_the_timestamp_then_the_hash() {
        let a = manifest("a", &[("n.md", rev("aaa", 10, 3))]);
        let b = manifest("b", &[("n.md", rev("bbb", 20, 3))]);
        assert_eq!(merge_manifests([&a, &b]).entries["n.md"].hash, "bbb");

        // Same revision and same instant: deterministic, whichever order the
        // manifests arrive in.
        let c = manifest("c", &[("n.md", rev("aaa", 10, 3))]);
        let d = manifest("d", &[("n.md", rev("bbb", 10, 3))]);
        assert_eq!(merge_manifests([&c, &d]).entries["n.md"].hash, "bbb");
        assert_eq!(merge_manifests([&d, &c]).entries["n.md"].hash, "bbb");
    }

    #[test]
    fn a_resolved_conflict_outranks_both_of_its_inputs() {
        let base = manifest("d", &[("n.md", rev("h1", 10, 4))]);
        let local = manifest("d", &[("n.md", rev("h2", 20, 5))]);
        let remote = manifest("d", &[("n.md", rev("h3", 30, 5))]);

        let plan = plan_sync(&base, &local, &remote, 100);
        match &plan.actions[0] {
            SyncAction::Conflict { resolved_rev, .. } => assert_eq!(*resolved_rev, 6),
            other => panic!("expected a conflict, got {other:?}"),
        }
    }

    #[test]
    fn merge_prefers_a_live_entry_over_a_tombstone_at_the_same_instant() {
        let a = manifest("a", &[("n.md", ManifestEntry::tombstone(10, 1))]);
        let b = manifest("b", &[("n.md", file("h1", 10))]);
        assert!(!merge_manifests([&a, &b]).entries["n.md"].is_deleted());
        assert!(!merge_manifests([&b, &a]).entries["n.md"].is_deleted());
    }

    #[test]
    fn conflict_paths_keep_the_extension_and_survive_dotted_folders() {
        assert_eq!(conflict_path_for("Feed/n.md"), "Feed/n.conflict.md");
        assert_eq!(conflict_path_for("Recordings/a.m4a"), "Recordings/a.conflict.m4a");
        assert_eq!(conflict_path_for("notes/plain"), "notes/plain.conflict");
        assert_eq!(conflict_path_for("v1.2/notes"), "v1.2/notes.conflict");
    }

    #[test]
    fn referenced_hashes_skip_tombstones() {
        let m = manifest(
            "d",
            &[("a.md", file("h1", 10)), ("b.md", ManifestEntry::tombstone(20, 2))],
        );
        let hashes = m.referenced_hashes();
        assert!(hashes.contains("h1"));
        assert_eq!(hashes.len(), 1);
    }
}
