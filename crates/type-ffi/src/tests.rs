//! Host-side end-to-end tests over the FFI surface. Everything lives in one
//! test function because the crate keeps process-global state (`APP_ENV`, the
//! security runtime, the transcription queue) — separate `#[test]`s sharing
//! one process would race each other.

use std::{fs, path::PathBuf, sync::Arc, time::Duration};

/// Minimal finalized M4A (`ftyp` + `moov`) as base64. Providers receive a file
/// path rather than decoding it, but the save boundary rejects interrupted
/// M4A containers before they can be synced.
const FAKE_AUDIO_BASE64: &str = "AAAADGZ0eXBNNEEgAAAACG1vb3Y=";
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
    assert!(uninitialized.unwrap_err().to_string().contains("init_core"));

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
    assert!(notes_root.join("_system/stream").is_dir());

    // ── Notes: create → read → write → rename → tree → previews ──────────────
    let created = parse(
        &crate::create_note(
            r#"{"folder_path":"_system/stream","content":"hello from ffi"}"#.to_string(),
        )
        .await
        .unwrap(),
    );
    let note_path = created["path"].as_str().unwrap().to_string();
    // The front-matter codec keeps a separating blank line at the top of the
    // body — same contract the desktop frontend sees over IPC.
    assert_eq!(
        crate::read_note(note_path.clone())
            .await
            .unwrap()
            .trim_start(),
        "hello from ffi"
    );

    crate::write_note(note_path.clone(), "updated body".to_string())
        .await
        .unwrap();
    assert_eq!(
        crate::read_note(note_path.clone())
            .await
            .unwrap()
            .trim_start(),
        "updated body"
    );

    let tree = parse(&crate::get_tree().await.unwrap());
    let system = tree["children"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == "_system")
        .expect("_system folder in tree");
    let stream = system["children"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == "_system/stream")
        .expect("stream folder in tree");
    assert!(!stream["notes"].as_array().unwrap().is_empty());

    let previews = parse(
        &crate::list_note_previews(vec![note_path.clone()])
            .await
            .unwrap(),
    );
    assert_eq!(previews[0]["path"], note_path.as_str());
    assert_eq!(
        previews[0]["content"].as_str().unwrap().trim(),
        "updated body"
    );
    // The tree and the preview stat the file on different paths; for an
    // unchanged note they must agree, or every launch would re-read it.
    let tree_version = stream["notes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|note| note["path"] == note_path.as_str())
        .expect("note in tree")["version"]
        .clone();
    assert!(tree_version.is_string());
    assert_eq!(previews[0]["version"], tree_version);
    assert_eq!(
        crate::read_note_if_exists("_system/stream/missing.md".into())
            .await
            .unwrap(),
        None
    );
    assert!(crate::read_note_if_exists("../invalid.md".into())
        .await
        .is_err());
    assert!(crate::read_note_if_exists("_system/stream".into())
        .await
        .is_err());
    let summaries = parse(
        &crate::list_note_summaries(vec![note_path.clone()])
            .await
            .unwrap(),
    );
    assert_eq!(summaries[0]["title"], "updated body");
    assert_eq!(summaries[0]["version"], tree_version);
    assert!(summaries[0].get("content").is_none());
    assert!(crate::list_note_summaries(vec![note_path.clone(); 201])
        .await
        .is_err());

    // A long document stays native: only two bounded Unicode lines cross FFI.
    let huge_body = format!(
        "{}\n{}\n{}",
        "🦀".repeat(10_000),
        "я".repeat(10_000),
        "body-only-secret".repeat(100_000)
    );
    let huge = parse(
        &crate::create_note(serde_json::json!({ "content": huge_body }).to_string())
            .await
            .unwrap(),
    );
    let huge_path = huge["path"].as_str().unwrap().to_string();
    let compact = crate::list_note_summaries(vec![huge_path.clone()])
        .await
        .unwrap();
    assert!(compact.len() < 4_000);
    assert!(!compact.contains("body-only-secret"));
    let compact = parse(&compact);
    assert_eq!(compact[0]["title"].as_str().unwrap().chars().count(), 384);
    assert_eq!(
        compact[0]["second_line"].as_str().unwrap().chars().count(),
        384
    );
    crate::delete_items(vec![huge_path]).await.unwrap();

    // Tags use the real header without changing or nesting the body.
    let before_tags = crate::read_note(note_path.clone()).await.unwrap();
    for tags in [serde_json::json!(["todo", "работа"]), serde_json::json!([])] {
        crate::update_note_tags(serde_json::json!({ "path": note_path, "tags": tags }).to_string())
            .await
            .unwrap();
        assert_eq!(
            crate::read_note(note_path.clone()).await.unwrap(),
            before_tags
        );
        assert_eq!(
            parse(&crate::get_note_meta(note_path.clone()).await.unwrap())["tags"],
            tags
        );
    }
    let registry = serde_json::json!({"version":1,"tags":[{"name":"work","color":"#123456","description":"Shared"}]});
    crate::write_tag_registry(registry.to_string())
        .await
        .unwrap();
    assert_eq!(parse(&crate::read_tag_registry().await.unwrap()), registry);

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
    // The unified native API preserves its structured incremental wire result.
    let repo = type_core::ensure_git_repo(&notes_root).unwrap();
    type_core::commit_all_changes(&repo, "synthetic baseline", "main").unwrap();
    let remote_path = app_dir.join("synthetic-remote.git");
    // Use the public core adapter to send to a new empty synthetic remote.
    // A regular local bare repository avoids any external/network dependency.
    std::process::Command::new("git")
        .args(["init", "--bare"])
        .arg(&remote_path)
        .output()
        .map(|output| assert!(output.status.success()))
        .unwrap();
    let cycle = parse(
        &crate::git_sync_cycle(
            serde_json::json!({ "remote_url": remote_path, "branch": "main" }).to_string(),
        )
        .await
        .unwrap(),
    );
    assert_eq!(cycle["push_error"], serde_json::Value::Null);
    assert_eq!(cycle["changed_paths"], serde_json::json!([]));
    assert_eq!(cycle["entries"], serde_json::json!([]));
    assert_eq!(cycle["removed_paths"], serde_json::json!([]));
    assert_eq!(cycle["status"]["push_required"], false);

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
        "folder_path": "_system/stream"
    });
    let saved = parse(
        &crate::save_audio_recording(save_args.to_string())
            .await
            .unwrap(),
    );
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
        "folder_path": "_system/stream"
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

    // Guarded editing preserves whitespace/frontmatter and never recreates a
    // deleted file or overwrites a remotely changed body.
    let guarded = parse(
        &crate::create_note(r#"{"content":"\nleading newline"}"#.into())
            .await
            .unwrap(),
    );
    let guarded_path = guarded["path"].as_str().unwrap().to_string();
    assert_eq!(
        crate::read_note_for_editing(guarded_path.clone())
            .await
            .unwrap()
            .unwrap(),
        "\nleading newline"
    );
    crate::write_note_checked(
        guarded_path.clone(),
        "edited".into(),
        "\nleading newline".into(),
    )
    .await
    .unwrap();
    crate::update_note_markers(
        serde_json::json!({"path":guarded_path,"archived":true}).to_string(),
    )
    .await
    .unwrap();
    crate::write_note_checked(guarded_path.clone(), "after marker".into(), "edited".into())
        .await
        .unwrap();
    crate::write_note(guarded_path.clone(), "remote body".into())
        .await
        .unwrap();
    assert!(crate::write_note_checked(
        guarded_path.clone(),
        "stale editor".into(),
        "after marker".into()
    )
    .await
    .is_err());
    assert!(
        crate::delete_note_checked(guarded_path.clone(), "after marker".into())
            .await
            .is_err()
    );
    assert_eq!(
        crate::read_note_for_editing(guarded_path.clone())
            .await
            .unwrap()
            .unwrap(),
        "remote body"
    );
    crate::delete_note_checked(guarded_path.clone(), "remote body".into())
        .await
        .unwrap();
    assert!(crate::write_note_checked(
        guarded_path.clone(),
        "resurrect".into(),
        "remote body".into()
    )
    .await
    .is_err());

    // Native file imports never require base64 in JavaScript.
    let audio_source = app_dir.join("capture.m4a");
    fs::write(
        &audio_source,
        type_core::decode_audio_base64(FAKE_AUDIO_BASE64).unwrap(),
    )
    .unwrap();
    let imported = parse(
        &crate::save_audio_recording_from_file(
            audio_source.to_string_lossy().into(),
            r#"{"mime_type":"audio/mp4"}"#.into(),
        )
        .await
        .unwrap(),
    );
    assert!(PathBuf::from(
        crate::get_recording_playback_path(imported["audio_path"].as_str().unwrap().into())
            .await
            .unwrap()
    )
    .is_file());
    assert!(crate::get_recording_playback_path("../outside.m4a".into())
        .await
        .is_err());
    let image_source = app_dir.join("capture.jpg");
    fs::write(&image_source, b"test-image").unwrap();
    let imported_photo = parse(
        &crate::save_handwriting_attachment_from_file(
            image_source.to_string_lossy().into(),
            r#"{"mime_type":"image/jpeg"}"#.into(),
        )
        .await
        .unwrap(),
    );
    assert!(notes_root
        .join(imported_photo["attachment_path"].as_str().unwrap())
        .is_file());
    assert!(crate::save_handwriting_attachment_from_file(
        image_source.to_string_lossy().into(),
        "null".into()
    )
    .await
    .is_err());
    assert!(crate::seal_draft("plain draft".into()).await.is_err());

    crate::enable_security(serde_json::json!({ "unlock_password": "synthetic-passphrase", "panic_password": "synthetic-panic" }).to_string()).await.unwrap();
    let sealed = crate::seal_draft("secret recovery".into()).await.unwrap();
    assert!(!sealed.contains("secret recovery"));
    assert_eq!(
        crate::open_draft(sealed.clone()).await.unwrap(),
        "secret recovery"
    );
    assert!(crate::open_draft("plaintext".into()).await.is_err());
    let encrypted = parse(
        &crate::create_note(r#"{"content":"\nsecret leading newline"}"#.into())
            .await
            .unwrap(),
    );
    let encrypted_path = encrypted["path"].as_str().unwrap().to_string();
    assert_eq!(
        crate::read_note_for_editing(encrypted_path.clone())
            .await
            .unwrap()
            .unwrap(),
        "\nsecret leading newline"
    );
    crate::write_note_checked(
        encrypted_path,
        "encrypted edit".into(),
        "\nsecret leading newline".into(),
    )
    .await
    .unwrap();
    crate::lock_security().await.unwrap();
    assert!(crate::git_sync_cycle("{}".into()).await.is_err());
    assert!(crate::open_draft(sealed).await.is_err());
    assert!(
        crate::read_note_if_exists("_system/stream/missing.md".into())
            .await
            .is_err()
    );
    assert!(crate::list_note_summaries(vec![recording_note_rel])
        .await
        .is_err());
    let _ = fs::remove_dir_all(&app_dir);
}
