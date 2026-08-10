//! Safe mobile cache eviction for audio attachments.
//!
//! New audio is copied to the desktop outside Git over Iroh. Durability
//! receipts are created only after the desktop hashes the received bytes;
//! device cache state stays local. A phone evicts only untracked audio after
//! validating the receipt, age, and completed transcription status.

use crate::{collect_recording_notes, now_ms, time_to_ms, AppEnv, RECORDING_STATUS_COMPLETED};
use git2::Repository;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::Path,
};

pub const AUDIO_RECEIPTS_REL_PATH: &str = ".type/audio-durability-receipts.json";
pub const AUDIO_CACHE_REL_PATH: &str = ".type/audio-cache.json";
pub const AUDIO_CACHE_EXCLUDE_PATTERN: &str = "/.type/audio-cache.json";
pub const AUDIO_GIT_EXCLUDE_PATTERNS: [&str; 2] = ["/Recordings/", "/_Recordings/"];
pub const MOBILE_AUDIO_RETENTION_DAYS: i64 = 7;
const DAY_MS: i64 = 24 * 60 * 60 * 1_000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct AudioDurabilityReceipt {
    audio_path: String,
    sha256: String,
    byte_length: u64,
    verified_on_desktop_ms: i64,
}

#[derive(Debug, Deserialize, Serialize)]
struct AudioReceiptManifest {
    version: u32,
    #[serde(default)]
    receipts: BTreeMap<String, AudioDurabilityReceipt>,
}

impl Default for AudioReceiptManifest {
    fn default() -> Self {
        Self {
            version: 1,
            receipts: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct EvictedAudioEntry {
    audio_path: String,
    sha256: String,
    evicted_ms: i64,
}

#[derive(Default, Debug, Deserialize, Serialize)]
struct AudioCacheManifest {
    #[serde(default)]
    evicted: BTreeMap<String, EvictedAudioEntry>,
    #[serde(default)]
    desktop_acks: BTreeMap<String, AudioDurabilityReceipt>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AudioReceiptIssueResult {
    pub scanned: usize,
    pub issued: usize,
    pub revoked: usize,
    pub unchanged: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct MobileAudioPruneResult {
    pub scanned: usize,
    pub evicted: usize,
    pub already_evicted: usize,
    pub waiting_for_age: usize,
    pub waiting_for_transcription: usize,
    pub waiting_for_desktop_receipt: usize,
    pub waiting_for_git_migration: usize,
}

/// Hash local desktop audio and publish/refresh receipts in a tracked manifest.
pub fn issue_desktop_audio_receipts(root: &Path) -> Result<AudioReceiptIssueResult, String> {
    let current =
        read_json_or_default::<AudioReceiptManifest>(&root.join(AUDIO_RECEIPTS_REL_PATH));
    let recordings = collect_recording_notes(root)?;
    let now = now_ms().unwrap_or(0);
    let mut next_receipts = BTreeMap::new();
    let mut result = AudioReceiptIssueResult {
        scanned: recordings.len(),
        issued: 0,
        revoked: 0,
        unchanged: 0,
    };

    for recording in recordings {
        if !recording.audio_path.is_file() {
            continue;
        }
        let (sha256, byte_length) = hash_file(&recording.audio_path)?;
        let next = AudioDurabilityReceipt {
            audio_path: recording.audio_rel.clone(),
            sha256,
            byte_length,
            verified_on_desktop_ms: now,
        };
        let unchanged = current
            .receipts
            .get(&recording.audio_rel)
            .map(|current| current.sha256 == next.sha256 && current.byte_length == next.byte_length)
            .unwrap_or(false);
        if unchanged {
            result.unchanged += 1;
            next_receipts.insert(
                recording.audio_rel.clone(),
                current.receipts[&recording.audio_rel].clone(),
            );
        } else {
            next_receipts.insert(recording.audio_rel, next);
            result.issued += 1;
        }
    }

    result.revoked = current
        .receipts
        .keys()
        .filter(|path| !next_receipts.contains_key(*path))
        .count();
    if result.issued > 0 || result.revoked > 0 {
        write_json(
            &root.join(AUDIO_RECEIPTS_REL_PATH),
            &AudioReceiptManifest {
                version: 1,
                receipts: next_receipts,
            },
        )?;
    }
    Ok(result)
}

/// Apply the seven-day mobile cache policy to the active working folder.
pub fn prune_mobile_audio_cache(app: &AppEnv) -> Result<MobileAudioPruneResult, String> {
    let root = crate::ensured_notes_root(app)?;
    prune_mobile_audio_cache_at(&root, now_ms().unwrap_or(0))
}

fn prune_mobile_audio_cache_at(root: &Path, now: i64) -> Result<MobileAudioPruneResult, String> {
    let receipts =
        read_json_or_default::<AudioReceiptManifest>(&root.join(AUDIO_RECEIPTS_REL_PATH));
    let cache_path = root.join(AUDIO_CACHE_REL_PATH);
    let mut cache = read_json_or_default::<AudioCacheManifest>(&cache_path);
    let recordings = collect_recording_notes(root)?;
    let repo = Repository::open(root)
        .map_err(|error| format!("Audio cache pruning needs an initialized Git repo: {error}"))?;
    // Repositories created by older app versions may not have the cache
    // exclude yet. Add it before the first local manifest can be written.
    crate::ensure_device_settings_excluded(&repo);
    let cutoff = now.saturating_sub(MOBILE_AUDIO_RETENTION_DAYS.saturating_mul(DAY_MS));
    let mut result = MobileAudioPruneResult {
        scanned: recordings.len(),
        evicted: 0,
        already_evicted: 0,
        waiting_for_age: 0,
        waiting_for_transcription: 0,
        waiting_for_desktop_receipt: 0,
        waiting_for_git_migration: 0,
    };

    for recording in recordings {
        if !recording.audio_path.is_file() {
            if is_audio_evicted_locally(root, &recording.audio_rel) {
                result.already_evicted += 1;
            } else {
                result.waiting_for_desktop_receipt += 1;
            }
            continue;
        }
        if recording.status != RECORDING_STATUS_COMPLETED {
            result.waiting_for_transcription += 1;
            continue;
        }
        let created_ms = recording.created_ms.or_else(|| {
            recording
                .audio_path
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(time_to_ms)
        });
        if created_ms.map(|created| created > cutoff).unwrap_or(true) {
            result.waiting_for_age += 1;
            continue;
        }
        // Only the tracked desktop manifest authorizes deletion. The direct
        // upload acknowledgement avoids duplicate transfers but is not a
        // retention receipt: the desktop can revoke the tracked receipt if
        // its archive disappears before the phone's next pull.
        let receipt = receipts.receipts.get(&recording.audio_rel);
        let Some(receipt) = receipt else {
            result.waiting_for_desktop_receipt += 1;
            continue;
        };
        let (sha256, byte_length) = hash_file(&recording.audio_path)?;
        if receipt.sha256 != sha256 || receipt.byte_length != byte_length {
            result.waiting_for_desktop_receipt += 1;
            continue;
        }

        if repo
            .index()
            .ok()
            .and_then(|index| index.get_path(Path::new(&recording.audio_rel), 0))
            .is_some()
        {
            // A tracked file would remain as a reachable blob in `.git` even
            // after its worktree copy was removed. Keep legacy recordings
            // until they can be migrated without pretending space was freed.
            result.waiting_for_git_migration += 1;
            continue;
        }
        if let Err(error) = fs::remove_file(&recording.audio_path) {
            return Err(format!(
                "Failed to evict cached audio '{}': {error}",
                recording.audio_path.display()
            ));
        }
        cache.evicted.insert(
            recording.audio_rel.clone(),
            EvictedAudioEntry {
                audio_path: recording.audio_rel,
                sha256,
                evicted_ms: now,
            },
        );
        result.evicted += 1;
    }

    if result.evicted > 0 {
        write_json(&cache_path, &cache)?;
    }
    Ok(result)
}

pub fn is_audio_evicted_locally(root: &Path, audio_rel: &str) -> bool {
    if root.join(audio_rel).is_file() {
        return false;
    }
    let cache = read_json_or_default::<AudioCacheManifest>(&root.join(AUDIO_CACHE_REL_PATH));
    cache.evicted.contains_key(audio_rel)
        || read_json_or_default::<AudioReceiptManifest>(&root.join(AUDIO_RECEIPTS_REL_PATH))
            .receipts
            .contains_key(audio_rel)
}

pub(crate) fn audio_has_desktop_ack(
    root: &Path,
    audio_rel: &str,
    sha256: &str,
    byte_length: u64,
) -> bool {
    let receipt_path = root.join(AUDIO_RECEIPTS_REL_PATH);
    if receipt_path.is_file() {
        return read_json_or_default::<AudioReceiptManifest>(&receipt_path)
            .receipts
            .get(audio_rel)
            .map(|receipt| receipt.sha256 == sha256 && receipt.byte_length == byte_length)
            .unwrap_or(false);
    }
    let cache = read_json_or_default::<AudioCacheManifest>(&root.join(AUDIO_CACHE_REL_PATH));
    cache
        .desktop_acks
        .get(audio_rel)
        .map(|receipt| receipt.sha256 == sha256 && receipt.byte_length == byte_length)
        .unwrap_or(false)
}

pub(crate) fn record_desktop_audio_ack(
    root: &Path,
    audio_rel: String,
    sha256: String,
    byte_length: u64,
) -> Result<(), String> {
    let path = root.join(AUDIO_CACHE_REL_PATH);
    let mut cache = read_json_or_default::<AudioCacheManifest>(&path);
    cache.desktop_acks.insert(
        audio_rel.clone(),
        AudioDurabilityReceipt {
            audio_path: audio_rel,
            sha256,
            byte_length,
            verified_on_desktop_ms: now_ms().unwrap_or(0),
        },
    );
    write_json(&path, &cache)
}

pub(crate) fn hash_file(path: &Path) -> Result<(String, u64), String> {
    use std::io::Read as _;

    let mut file = fs::File::open(path)
        .map_err(|error| format!("Failed to verify audio '{}': {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut byte_length = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Failed to verify audio '{}': {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        byte_length = byte_length.saturating_add(read as u64);
    }
    let sha256 = format!("{:x}", hasher.finalize());
    Ok((sha256, byte_length))
}

fn read_json_or_default<T>(path: &Path) -> T
where
    T: serde::de::DeserializeOwned + Default,
{
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create attachment metadata folder: {error}"))?;
    }
    let content = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Failed to serialize attachment metadata: {error}"))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|error| format!("Failed to write attachment metadata: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{commit_all_changes, ensure_git_repo};
    use std::path::PathBuf;

    fn recording_fixture(tag: &str, status: &str, created_ms: i64) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "type-audio-retention-{tag}-{}",
            uuid::Uuid::now_v7()
        ));
        fs::create_dir_all(root.join("Feed")).unwrap();
        fs::create_dir_all(root.join("Recordings")).unwrap();
        fs::write(root.join("Recordings/audio.m4a"), b"audio bytes").unwrap();
        fs::write(
            root.join("Feed/recording.md"),
            format!(
                "---\ncreated_ms: {created_ms}\ntype: audio_recording\nrecording_audio_path: Recordings/audio.m4a\ntranscription_status: {status}\n---\ntranscript\n"
            ),
        )
        .unwrap();
        let repo = ensure_git_repo(&root).unwrap();
        crate::set_audio_git_exclusion(&repo, true).unwrap();
        commit_all_changes(&repo, "fixture", "main").unwrap();
        root
    }

    #[test]
    fn evicts_only_after_matching_receipt_completed_and_week_old() {
        let now = 2_000_000_000_000i64;
        let root = recording_fixture("eligible", "completed", now - 8 * DAY_MS);
        let repo = Repository::open(&root).unwrap();
        assert!(repo
            .index()
            .unwrap()
            .get_path(Path::new("Recordings/audio.m4a"), 0)
            .is_none());
        assert!(repo
            .head()
            .unwrap()
            .peel_to_tree()
            .unwrap()
            .get_path(Path::new("Recordings/audio.m4a"))
            .is_err());
        drop(repo);
        let issued = issue_desktop_audio_receipts(&root).unwrap();
        assert_eq!(issued.issued, 1);
        let repo = Repository::open(&root).unwrap();
        commit_all_changes(&repo, "desktop receipt", "main").unwrap();
        drop(repo);
        let result = prune_mobile_audio_cache_at(&root, now).unwrap();
        assert_eq!(result.evicted, 1);
        assert!(!root.join("Recordings/audio.m4a").exists());
        assert!(is_audio_evicted_locally(&root, "Recordings/audio.m4a"));
        assert!(!crate::git_has_changes(&Repository::open(&root).unwrap()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn keeps_untranscribed_or_recent_audio() {
        let now = 2_000_000_000_000i64;
        for (tag, status, created_ms) in [
            ("pending", "pending", now - 8 * DAY_MS),
            ("recent", "completed", now - 6 * DAY_MS),
        ] {
            let root = recording_fixture(tag, status, created_ms);
            issue_desktop_audio_receipts(&root).unwrap();
            let result = prune_mobile_audio_cache_at(&root, now).unwrap();
            assert_eq!(result.evicted, 0);
            assert!(root.join("Recordings/audio.m4a").exists());
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn keeps_audio_when_receipt_hash_no_longer_matches() {
        let now = 2_000_000_000_000i64;
        let root = recording_fixture("changed", "completed", now - 8 * DAY_MS);
        issue_desktop_audio_receipts(&root).unwrap();
        fs::write(root.join("Recordings/audio.m4a"), b"different bytes").unwrap();
        let result = prune_mobile_audio_cache_at(&root, now).unwrap();
        assert_eq!(result.evicted, 0);
        assert_eq!(result.waiting_for_desktop_receipt, 1);
        assert!(root.join("Recordings/audio.m4a").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn desktop_revokes_receipt_when_its_audio_is_missing() {
        let now = 2_000_000_000_000i64;
        let root = recording_fixture("revoked", "completed", now - 8 * DAY_MS);
        assert_eq!(issue_desktop_audio_receipts(&root).unwrap().issued, 1);
        fs::remove_file(root.join("Recordings/audio.m4a")).unwrap();

        let result = issue_desktop_audio_receipts(&root).unwrap();
        assert_eq!(result.revoked, 1);
        let manifest = read_json_or_default::<AudioReceiptManifest>(
            &root.join(AUDIO_RECEIPTS_REL_PATH),
        );
        assert!(manifest.receipts.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn keeps_legacy_audio_that_is_still_stored_in_git() {
        let now = 2_000_000_000_000i64;
        let root = recording_fixture("legacy", "completed", now - 8 * DAY_MS);
        let repo = Repository::open(&root).unwrap();
        crate::set_audio_git_exclusion(&repo, false).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("Recordings/audio.m4a")).unwrap();
        index.write().unwrap();
        commit_all_changes(&repo, "legacy tracked audio", "main").unwrap();
        issue_desktop_audio_receipts(&root).unwrap();

        let result = prune_mobile_audio_cache_at(&root, now).unwrap();
        assert_eq!(result.evicted, 0);
        assert_eq!(result.waiting_for_git_migration, 1);
        assert!(root.join("Recordings/audio.m4a").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
