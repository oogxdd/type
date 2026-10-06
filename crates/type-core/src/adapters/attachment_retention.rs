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
use std::{collections::BTreeMap, fs, path::Path};

pub const AUDIO_RECEIPTS_REL_PATH: &str = ".type/audio-durability-receipts.json";
pub const AUDIO_CACHE_REL_PATH: &str = ".type/audio-cache.json";
pub const AUDIO_CACHE_EXCLUDE_PATTERN: &str = "/.type/audio-cache.json";
/// Written to `.git/info/exclude` while audio is kept out of Git.
pub const AUDIO_GIT_EXCLUDE_PATTERNS: [&str; 1] = ["/_system/_recordings/"];
/// Also stripped when that file is rewritten, so a root that predates the
/// `_system` layout stops ignoring a folder the user may now own.
pub const LEGACY_AUDIO_GIT_EXCLUDE_PATTERNS: [&str; 2] = ["/Recordings/", "/_Recordings/"];
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
    let state = crate::application::workspace::workspace_state(root)?;
    let plan = prepare_desktop_audio_receipts(root, &state, &mut DesktopReceiptCache::default())?;
    crate::application::workspace::with_workspace_write(root, || {
        publish_desktop_audio_receipts(root, &state, plan)?
            .ok_or_else(|| "Audio receipt snapshot changed; retry maintenance.".into())
    })
}

/// Session-local evidence. A receipt imported from Git never seeds this cache.
/// On Unix the fingerprint includes inode and ctime nanoseconds, so replacing
/// bytes and restoring mtime/length still forces verification. Other platforms
/// conservatively rehash. No plaintext note bodies or evidence persist to disk.
#[derive(Default)]
pub(crate) struct DesktopReceiptCache {
    verified: BTreeMap<std::path::PathBuf, (AudioFingerprint, String, u64)>,
    notes: BTreeMap<std::path::PathBuf, (AudioFingerprint, Option<crate::RecordingNoteInfo>)>,
    pub(crate) hash_reads: usize,
    pub(crate) note_reads: usize,
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct AudioFingerprint {
    length: u64,
    modified: Option<std::time::SystemTime>,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}
fn audio_fingerprint(path: &Path) -> Option<AudioFingerprint> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    Some(AudioFingerprint {
        length: metadata.len(),
        modified: metadata.modified().ok(),
        #[cfg(unix)]
        identity: {
            use std::os::unix::fs::MetadataExt;
            (
                metadata.dev(),
                metadata.ino(),
                metadata.ctime(),
                metadata.ctime_nsec(),
            )
        },
    })
}
pub(crate) struct DesktopReceiptPlan {
    revision: u64,
    source: Option<Vec<u8>>,
    observed: BTreeMap<std::path::PathBuf, Option<AudioFingerprint>>,
    next: AudioReceiptManifest,
    result: AudioReceiptIssueResult,
}
pub(crate) fn prepare_desktop_audio_receipts(
    root: &Path,
    state: &crate::application::workspace::WorkspaceState,
    cache: &mut DesktopReceiptCache,
) -> Result<DesktopReceiptPlan, String> {
    let revision = state.revision();
    let source = fs::read(root.join(AUDIO_RECEIPTS_REL_PATH)).ok();
    let current = source
        .as_deref()
        .and_then(|bytes| serde_json::from_slice::<AudioReceiptManifest>(bytes).ok())
        .unwrap_or_default();
    let mut note_files = Vec::new();
    crate::collect_markdown_note_files(root, root, &mut note_files)?;
    let mut note_observed = BTreeMap::new();
    let mut recordings = Vec::new();
    for path in note_files {
        let Some(fingerprint) = audio_fingerprint(&path) else {
            continue;
        };
        let info = if let Some((_, info)) = cache
            .notes
            .get(&path)
            .filter(|(known, _)| cfg!(unix) && *known == fingerprint)
        {
            info.clone()
        } else {
            let raw = match fs::read_to_string(&path) {
                Ok(raw) => raw,
                Err(_) => {
                    // Same conservative policy as collect_recording_notes:
                    // unreadable metadata cannot authorize cache eviction.
                    cache.notes.remove(&path);
                    note_observed.insert(path, Some(fingerprint));
                    continue;
                }
            };
            cache.note_reads += 1;
            if audio_fingerprint(&path).as_ref() != Some(&fingerprint) {
                return Err("Note changed during receipt scan; retry maintenance.".into());
            }
            let (meta, _) = crate::parse_note_front_matter(&raw);
            let info = crate::adapters::recordings::recording_info_from_note_meta(
                root,
                &path,
                &crate::strip_root(root, &path),
                &meta,
            );
            cache
                .notes
                .insert(path.clone(), (fingerprint.clone(), info.clone()));
            info
        };
        note_observed.insert(path, Some(fingerprint));
        if let Some(info) = info {
            recordings.push(info);
        }
    }
    cache
        .notes
        .retain(|path, _| note_observed.contains_key(path));
    let now = now_ms().unwrap_or(0);
    let mut next_receipts = BTreeMap::new();
    let mut observed = note_observed;
    let mut result = AudioReceiptIssueResult {
        scanned: recordings.len(),
        issued: 0,
        revoked: 0,
        unchanged: 0,
    };
    for recording in recordings {
        let fingerprint = audio_fingerprint(&recording.audio_path);
        observed.insert(recording.audio_path.clone(), fingerprint.clone());
        let Some(fingerprint) = fingerprint else {
            continue;
        };
        let cached = cache
            .verified
            .get(&recording.audio_path)
            .filter(|(known, _, _)| cfg!(unix) && *known == fingerprint);
        let (sha256, byte_length) = if let Some((_, hash, length)) = cached {
            (hash.clone(), *length)
        } else {
            let verified = hash_file(&recording.audio_path)?;
            cache.hash_reads += 1;
            if audio_fingerprint(&recording.audio_path).as_ref() != Some(&fingerprint) {
                return Err("Audio changed during hash verification; retry maintenance.".into());
            }
            cache.verified.insert(
                recording.audio_path.clone(),
                (fingerprint, verified.0.clone(), verified.1),
            );
            verified
        };
        let next = AudioDurabilityReceipt {
            audio_path: recording.audio_rel.clone(),
            sha256,
            byte_length,
            verified_on_desktop_ms: now,
        };
        if current
            .receipts
            .get(&recording.audio_rel)
            .is_some_and(|current| {
                current.sha256 == next.sha256 && current.byte_length == next.byte_length
            })
        {
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
    cache
        .verified
        .retain(|path, _| observed.get(path).is_some_and(Option::is_some));
    result.revoked = current
        .receipts
        .keys()
        .filter(|path| !next_receipts.contains_key(*path))
        .count();
    Ok(DesktopReceiptPlan {
        revision,
        source,
        observed,
        next: AudioReceiptManifest {
            version: 1,
            receipts: next_receipts,
        },
        result,
    })
}
/// Caller holds the worktree write transaction. Git counter and revision are
/// checked here, after all scanning/hashing outside the lock.
pub(crate) fn publish_desktop_audio_receipts(
    root: &Path,
    state: &crate::application::workspace::WorkspaceState,
    plan: DesktopReceiptPlan,
) -> Result<Option<AudioReceiptIssueResult>, String> {
    if state.git_active()
        || state.revision() != plan.revision
        || fs::read(root.join(AUDIO_RECEIPTS_REL_PATH)).ok() != plan.source
        || plan
            .observed
            .iter()
            .any(|(path, fingerprint)| &audio_fingerprint(path) != fingerprint)
    {
        return Ok(None);
    }
    if plan.result.issued > 0 || plan.result.revoked > 0 {
        write_json(&root.join(AUDIO_RECEIPTS_REL_PATH), &plan.next)?;
    }
    Ok(Some(plan.result))
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
            if cache.evicted.contains_key(&recording.audio_rel)
                || receipts.receipts.contains_key(&recording.audio_rel)
            {
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

/// Load once per archive scan instead of parsing the growing manifests for
/// every recording. A tracked manifest remains authoritative, including when
/// it is empty (the desktop may have revoked a receipt).
pub(crate) struct AudioArchiveReceipts(BTreeMap<String, AudioDurabilityReceipt>);

impl AudioArchiveReceipts {
    pub(crate) fn load(root: &Path) -> Self {
        let path = root.join(AUDIO_RECEIPTS_REL_PATH);
        if path.is_file() {
            Self(read_json_or_default::<AudioReceiptManifest>(&path).receipts)
        } else {
            Self(
                read_json_or_default::<AudioCacheManifest>(&root.join(AUDIO_CACHE_REL_PATH))
                    .desktop_acks,
            )
        }
    }

    pub(crate) fn matches(&self, audio_rel: &str, sha256: &str, byte_length: u64) -> bool {
        self.0
            .get(audio_rel)
            .map(|receipt| receipt.sha256 == sha256 && receipt.byte_length == byte_length)
            .unwrap_or(false)
    }
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
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::now_v7()));
    fs::write(&temporary, format!("{content}\n"))
        .and_then(|_| fs::rename(&temporary, path))
        .map_err(|error| {
            let _ = fs::remove_file(&temporary);
            format!("Failed to write attachment metadata: {error}")
        })
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
        fs::create_dir_all(root.join("_system/stream")).unwrap();
        fs::create_dir_all(root.join("_system/_recordings")).unwrap();
        fs::write(root.join("_system/_recordings/audio.m4a"), b"audio bytes").unwrap();
        fs::write(
            root.join("_system/stream/recording.md"),
            format!(
                "---\ncreated_ms: {created_ms}\ntype: audio_recording\nrecording_audio_path: _system/_recordings/audio.m4a\ntranscription_status: {status}\n---\ntranscript\n"
            ),
        )
        .unwrap();
        let repo = ensure_git_repo(&root).unwrap();
        crate::set_audio_git_exclusion(&repo, true).unwrap();
        commit_all_changes(&repo, "fixture", "main").unwrap();
        root
    }

    #[test]
    fn warm_receipts_read_only_changed_notes_and_reverify_changed_bytes() {
        let root = recording_fixture("incremental", "completed", 0);
        for index in 0..6600 {
            fs::write(
                root.join(format!("_system/stream/n-{index:04}.md")),
                format!("text {index}\n{}", "markdown body\n".repeat(75)),
            )
            .unwrap();
        }
        let state = crate::application::workspace::workspace_state(&root).unwrap();
        let mut cache = DesktopReceiptCache::default();
        let started = std::time::Instant::now();
        let plan = prepare_desktop_audio_receipts(&root, &state, &mut cache).unwrap();
        assert_eq!(cache.note_reads, 6601);
        assert_eq!(cache.hash_reads, 1);
        let result = crate::application::workspace::with_workspace_write(&root, || {
            publish_desktop_audio_receipts(&root, &state, plan)
        })
        .unwrap()
        .unwrap();
        assert_eq!(result.issued, 1);
        eprintln!(
            "[receipt-benchmark] cold notes=6601 body_reads={} hash_reads={} elapsed_ms={}",
            cache.note_reads,
            cache.hash_reads,
            started.elapsed().as_millis()
        );
        let started = std::time::Instant::now();
        let plan = prepare_desktop_audio_receipts(&root, &state, &mut cache).unwrap();
        assert_eq!(plan.result.unchanged, 1);
        #[cfg(unix)]
        {
            assert_eq!(cache.note_reads, 6601);
            assert_eq!(cache.hash_reads, 1);
        }
        eprintln!("[receipt-benchmark] warm additional_body_reads={} additional_hash_reads={} elapsed_ms={}", cache.note_reads - 6601, cache.hash_reads - 1, started.elapsed().as_millis());
        let path = root.join("_system/stream/n-0001.md");
        fs::write(&path, "one changed note").unwrap();
        prepare_desktop_audio_receipts(&root, &state, &mut cache).unwrap();
        #[cfg(unix)]
        assert_eq!(cache.note_reads, 6602);
        let audio = root.join("_system/_recordings/audio.m4a");
        let mtime = fs::metadata(&audio).unwrap().modified().unwrap();
        fs::write(&audio, b"other bytes").unwrap();
        fs::File::open(&audio)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(mtime))
            .unwrap();
        let plan = prepare_desktop_audio_receipts(&root, &state, &mut cache).unwrap();
        assert_eq!(plan.result.issued, 1);
        #[cfg(unix)]
        assert_eq!(
            cache.hash_reads, 2,
            "same length and restored mtime must not reuse old evidence"
        );
        crate::application::workspace::with_workspace_write(&root, || {
            publish_desktop_audio_receipts(&root, &state, plan)
        })
        .unwrap()
        .unwrap();
        fs::remove_file(&audio).unwrap();
        let plan = prepare_desktop_audio_receipts(&root, &state, &mut cache).unwrap();
        assert_eq!(plan.result.revoked, 1);
        crate::application::workspace::with_workspace_write(&root, || {
            publish_desktop_audio_receipts(&root, &state, plan)
        })
        .unwrap()
        .unwrap();
        assert!(
            read_json_or_default::<AudioReceiptManifest>(&root.join(AUDIO_RECEIPTS_REL_PATH))
                .receipts
                .is_empty()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn receipt_publication_rejects_active_git_and_stale_snapshot() {
        let root = recording_fixture("coordination", "completed", 0);
        let state = crate::application::workspace::workspace_state(&root).unwrap();
        let mut cache = DesktopReceiptCache::default();
        let service =
            crate::application::workspace::with_workspace_write(&root, || Ok(state.begin_git()))
                .unwrap();
        let plan = prepare_desktop_audio_receipts(&root, &state, &mut cache).unwrap();
        assert!(
            crate::application::workspace::with_workspace_write(&root, || {
                publish_desktop_audio_receipts(&root, &state, plan)
            })
            .unwrap()
            .is_none()
        );
        assert!(!root.join(AUDIO_RECEIPTS_REL_PATH).exists());
        drop(service);
        let plan = prepare_desktop_audio_receipts(&root, &state, &mut cache).unwrap();
        crate::application::workspace::with_workspace_write(&root, || {
            fs::write(root.join("other.md"), "edit").unwrap();
            Ok(())
        })
        .unwrap();
        assert!(
            crate::application::workspace::with_workspace_write(&root, || {
                publish_desktop_audio_receipts(&root, &state, plan)
            })
            .unwrap()
            .is_none()
        );
        let plan = prepare_desktop_audio_receipts(&root, &state, &mut cache).unwrap();
        fs::write(
            root.join("_system/_recordings/audio.m4a"),
            b"external bytes",
        )
        .unwrap();
        assert!(
            crate::application::workspace::with_workspace_write(&root, || {
                publish_desktop_audio_receipts(&root, &state, plan)
            })
            .unwrap()
            .is_none()
        );
        let plan = prepare_desktop_audio_receipts(&root, &state, &mut cache).unwrap();
        assert!(
            crate::application::workspace::with_workspace_write(&root, || {
                publish_desktop_audio_receipts(&root, &state, plan)
            })
            .unwrap()
            .is_some()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn archive_receipt_snapshot_respects_desktop_revocation() {
        let root = recording_fixture("ack-snapshot", "completed", 0);
        record_desktop_audio_ack(
            &root,
            "_system/_recordings/audio.m4a".into(),
            "hash".into(),
            12,
        )
        .unwrap();
        assert!(AudioArchiveReceipts::load(&root).matches(
            "_system/_recordings/audio.m4a",
            "hash",
            12
        ));
        assert!(!AudioArchiveReceipts::load(&root).matches(
            "_system/_recordings/audio.m4a",
            "changed",
            12
        ));
        write_json(
            &root.join(AUDIO_RECEIPTS_REL_PATH),
            &AudioReceiptManifest::default(),
        )
        .unwrap();
        assert!(!AudioArchiveReceipts::load(&root).matches(
            "_system/_recordings/audio.m4a",
            "hash",
            12
        ));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn evicts_only_after_matching_receipt_completed_and_week_old() {
        let now = 2_000_000_000_000i64;
        let root = recording_fixture("eligible", "completed", now - 8 * DAY_MS);
        let repo = Repository::open(&root).unwrap();
        assert!(repo
            .index()
            .unwrap()
            .get_path(Path::new("_system/_recordings/audio.m4a"), 0)
            .is_none());
        assert!(repo
            .head()
            .unwrap()
            .peel_to_tree()
            .unwrap()
            .get_path(Path::new("_system/_recordings/audio.m4a"))
            .is_err());
        drop(repo);
        let issued = issue_desktop_audio_receipts(&root).unwrap();
        assert_eq!(issued.issued, 1);
        let repo = Repository::open(&root).unwrap();
        commit_all_changes(&repo, "desktop receipt", "main").unwrap();
        drop(repo);
        let result = prune_mobile_audio_cache_at(&root, now).unwrap();
        assert_eq!(result.evicted, 1);
        assert!(!root.join("_system/_recordings/audio.m4a").exists());
        assert!(is_audio_evicted_locally(
            &root,
            "_system/_recordings/audio.m4a"
        ));
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
            assert!(root.join("_system/_recordings/audio.m4a").exists());
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn keeps_audio_when_receipt_hash_no_longer_matches() {
        let now = 2_000_000_000_000i64;
        let root = recording_fixture("changed", "completed", now - 8 * DAY_MS);
        issue_desktop_audio_receipts(&root).unwrap();
        fs::write(
            root.join("_system/_recordings/audio.m4a"),
            b"different bytes",
        )
        .unwrap();
        let result = prune_mobile_audio_cache_at(&root, now).unwrap();
        assert_eq!(result.evicted, 0);
        assert_eq!(result.waiting_for_desktop_receipt, 1);
        assert!(root.join("_system/_recordings/audio.m4a").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn desktop_revokes_receipt_when_its_audio_is_missing() {
        let now = 2_000_000_000_000i64;
        let root = recording_fixture("revoked", "completed", now - 8 * DAY_MS);
        assert_eq!(issue_desktop_audio_receipts(&root).unwrap().issued, 1);
        fs::remove_file(root.join("_system/_recordings/audio.m4a")).unwrap();

        let result = issue_desktop_audio_receipts(&root).unwrap();
        assert_eq!(result.revoked, 1);
        let manifest =
            read_json_or_default::<AudioReceiptManifest>(&root.join(AUDIO_RECEIPTS_REL_PATH));
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
        index
            .add_path(Path::new("_system/_recordings/audio.m4a"))
            .unwrap();
        index.write().unwrap();
        commit_all_changes(&repo, "legacy tracked audio", "main").unwrap();
        issue_desktop_audio_receipts(&root).unwrap();

        let result = prune_mobile_audio_cache_at(&root, now).unwrap();
        assert_eq!(result.evicted, 0);
        assert_eq!(result.waiting_for_git_migration, 1);
        assert!(root.join("_system/_recordings/audio.m4a").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
