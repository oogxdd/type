//! Host-side end-to-end tests over the FFI surface. Everything lives in one
//! test function because the crate keeps process-global state (`APP_ENV`, the
//! security runtime, the transcription queue) — separate `#[test]`s sharing
//! one process would race each other.

use std::{fs, path::PathBuf, sync::Arc, time::Duration};

/// "test-audio" as base64. Providers receive a file path, not parsed audio,
/// so the content never has to be a real recording.
const FAKE_AUDIO_BASE64: &str = "dGVzdC1hdWRpbw==";
/// Minimal payload is sufficient because save validates the declared format,
/// not image decoding; desktop OCR is intentionally not invoked in this test.
const FAKE_IMAGE_BASE64: &str = "dGVzdC1pbWFnZQ==";

struct FixedTranscript;

#[async_trait::async_trait]
impl crate::TranscriptionProvider for FixedTranscript {
    fn id(&self) -> String {
        "test-provider".to_string()
    }

    async fn transcribe(&self, audio_path: String) -> Result<String, crate::CoreError> {
        assert!(
            PathBuf::from(&audio_path).is_file(),
            "worker should hand the provider an existing audio file"
        );
        Ok("provider transcript".to_string())
    }
}

fn parse(json: &str) -> serde_json::Value {
    serde_json::from_str(json).expect("FFI returned invalid JSON")
}

#[tokio::test(flavor = "multi_thread")]
async fn ffi_end_to_end() {
    // Calls before init_core fail with a clear message instead of panicking.
    let uninitialized = crate::get_tree().await;
    assert!(uninitialized
        .unwrap_err()
        .to_string()
        .contains("init_core"));

    let app_dir = std::env::temp_dir().join(format!("type-ffi-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&app_dir);
    fs::create_dir_all(&app_dir).unwrap();
    crate::init_core(app_dir.to_string_lossy().into_owned(), None).unwrap();

    // ── Profiles: a default working folder exists with system folders ─────────
    let snapshot = parse(&crate::get_profiles().await.unwrap());
    let profile_id = snapshot["active_profile_id"].as_str().unwrap().to_string();
    assert!(!profile_id.is_empty());
    let profile = snapshot["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"].as_str() == Some(profile_id.as_str()))
        .expect("active profile is listed");
    let notes_root = PathBuf::from(profile["notes_root"].as_str().unwrap());
    assert!(notes_root.join("Feed").is_dir());

    // ── Notes: create → read → write → rename → tree → previews ──────────────
    let created = parse(
        &crate::create_note(r#"{"folder_path":"Feed","content":"hello from ffi"}"#.to_string())
            .await
            .unwrap(),
    );
    let note_path = created["path"].as_str().unwrap().to_string();
    // The front-matter codec keeps a separating blank line at the top of the
    // body — same contract the desktop frontend sees over IPC.
    assert_eq!(
        crate::read_note(note_path.clone()).await.unwrap().trim_start(),
        "hello from ffi"
    );

    crate::write_note(note_path.clone(), "updated body".to_string())
        .await
        .unwrap();
    assert_eq!(
        crate::read_note(note_path.clone()).await.unwrap().trim_start(),
        "updated body"
    );

    let tree = parse(&crate::get_tree().await.unwrap());
    let feed = tree["children"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["name"] == "Feed")
        .expect("Feed folder in tree");
    assert!(!feed["notes"].as_array().unwrap().is_empty());

    let previews = parse(&crate::list_note_previews(vec![note_path.clone()]).await.unwrap());
    assert_eq!(previews[0]["path"], note_path.as_str());
    assert_eq!(previews[0]["content"].as_str().unwrap().trim(), "updated body");

    // ── Working-folder settings: transcription_mode round-trip ────────────────
    let settings_args = serde_json::json!({
        "profile_id": profile_id,
        "settings": {
            "git_remote_url": "",
            "git_branch": "main",
            "git_username": "",
            "git_password": "",
            "git_commit_message": "Sync notes",
            "git_trusted_ssh_host": "",
            "git_trusted_ssh_host_key_sha256": "",
            "mobile_auto_transcription_enabled": true,
            "mobile_auto_handwriting_ocr_enabled": true,
            "transcription_mode": "native"
        }
    });
    let snapshot = parse(
        &crate::update_profile_settings(settings_args.to_string())
            .await
            .unwrap(),
    );
    let persisted = fs::read_to_string(notes_root.join(".type").join("settings.json")).unwrap();
    assert!(persisted.contains("\"transcription_mode\": \"native\""));
    let profile = snapshot["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"].as_str() == Some(profile_id.as_str()))
        .unwrap();
    assert_eq!(profile["settings"]["transcription_mode"], "native");

    // ── Security: fresh install is disabled + unlocked ────────────────────────
    let security = parse(&crate::get_security_state().await.unwrap());
    assert_eq!(security["encryption_enabled"], false);
    assert_eq!(security["locked"], false);

    // ── Git: status on an unconnected root + SSH key lifecycle (offline) ─────
    let status = parse(&crate::get_git_status().await.unwrap());
    assert_eq!(status["repo_initialized"], false);

    let public_key = crate::generate_ssh_key().await.unwrap();
    assert!(public_key.contains("ssh-ed25519"));
    let fetched = crate::get_ssh_public_key().await.unwrap();
    assert_eq!(fetched.as_deref(), Some(public_key.as_str()));
    crate::delete_ssh_key().await.unwrap();
    assert_eq!(crate::get_ssh_public_key().await.unwrap(), None);

    // ── Recordings: save, then transcribe through a foreign provider ─────────
    let save_args = serde_json::json!({
        "audio_base64": FAKE_AUDIO_BASE64,
        "mime_type": "audio/mp4",
        "folder_path": "Feed"
    });
    let saved = parse(&crate::save_audio_recording(save_args.to_string()).await.unwrap());
    let recording_note_rel = saved["note_path"].as_str().unwrap().to_string();

    let queued = parse(
        &crate::queue_provider_transcriptions(Arc::new(FixedTranscript))
            .await
            .unwrap(),
    );
    assert_eq!(queued["queued"], 1);

    // The worker runs on its own thread; poll the note until it completes.
    let recording_note_path = notes_root.join(&recording_note_rel);
    let mut completed = false;
    for _ in 0..100 {
        let raw = fs::read_to_string(&recording_note_path).unwrap();
        if raw.contains("transcription_status: completed") {
            assert!(raw.contains("provider transcript"));
            completed = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(completed, "provider transcription should complete");

    let listing = parse(&crate::list_recordings().await.unwrap());
    assert_eq!(listing["recordings"].as_array().unwrap().len(), 1);
    assert_eq!(listing["recordings"][0]["status"], "completed");

    // ── Handwriting: mobile saves pending; no OCR runs on the phone ──────────
    let handwriting_args = serde_json::json!({
        "image_base64": FAKE_IMAGE_BASE64,
        "mime_type": "image/jpeg",
        "file_name": "page.jpg",
        "folder_path": "Feed"
    });
    let handwriting = parse(
        &crate::save_handwriting_attachment(handwriting_args.to_string())
            .await
            .unwrap(),
    );
    let handwriting_note =
        fs::read_to_string(notes_root.join(handwriting["note_path"].as_str().unwrap())).unwrap();
    assert!(handwriting_note.contains("type: handwriting_attachment"));
    assert!(handwriting_note.contains("ocr_status: pending"));
    assert!(!handwriting_note.contains("ocr_status: completed"));

    let _ = fs::remove_dir_all(&app_dir);
}
