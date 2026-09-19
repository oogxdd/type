use super::*;
use iroh::protocol::Router;
use type_sync_peer::{MailboxProtocol, Store, ALPN};

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("type-mailbox-client-{}", random_secret()));
        fs::create_dir_all(&p).unwrap();
        Self(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
async fn endpoint() -> Endpoint {
    Endpoint::builder(presets::Minimal)
        .clear_ip_transports()
        .bind_addr((std::net::Ipv4Addr::LOCALHOST, 0))
        .unwrap()
        .bind()
        .await
        .unwrap()
}
fn config(pairing: &Pairing) -> Config {
    Config {
        pairing: pairing.clone(),
        pin: Head::default(),
        last_sync_ms: None,
        imported_packs: BTreeSet::new(),
    }
}
fn write(root: &Path, path: &str, bytes: &[u8]) {
    let dest = root.join(path);
    fs::create_dir_all(dest.parent().unwrap()).unwrap();
    fs::write(dest, bytes).unwrap();
}

#[tokio::test]
async fn offline_devices_exchange_plain_local_notes_encrypted_history_and_audio() {
    let peer = Temp::new();
    let phone = Temp::new();
    let desktop = Temp::new();
    let state = Temp::new();
    let token = random_secret();
    let server = endpoint().await;
    let pairing = Pairing {
        endpoint: server.id().to_string(),
        token: token.clone(),
        vault: digest(b"test vault"),
        key: random_secret(),
    };
    let router = Router::builder(server)
        .accept(
            ALPN,
            MailboxProtocol::new(Store::load(&peer.0, &token, 10_000_000).unwrap()),
        )
        .spawn();
    let local = endpoint().await;
    let client = Client::connect_addr(&local, router.endpoint().addr(), &token)
        .await
        .unwrap();
    let mut a = config(&pairing);
    let mut b = config(&pairing);
    write(
        &phone.0,
        "Feed/private-filename.md",
        b"top secret note contents\n",
    );
    write(
        &phone.0,
        "Recordings/private-recording.m4a",
        b"secret audio bytes",
    );
    write(
        &phone.0,
        ".type/device.json",
        b"device credentials must never sync",
    );
    sync_folder(&phone.0, &state.0.join("a.json"), &mut a, &client)
        .await
        .unwrap();
    let first_pin = a.pin.clone();
    // Phone has finished and disconnects before the other device connects.
    drop(client);
    let client = Client::connect_addr(&local, router.endpoint().addr(), &token)
        .await
        .unwrap();
    sync_folder(&desktop.0, &state.0.join("b.json"), &mut b, &client)
        .await
        .unwrap();
    assert_eq!(
        fs::read(desktop.0.join("Feed/private-filename.md")).unwrap(),
        b"top secret note contents\n"
    );
    assert_eq!(
        fs::read(desktop.0.join("Recordings/private-recording.m4a")).unwrap(),
        b"secret audio bytes"
    );
    assert!(!desktop.0.join(".type/device.json").exists());
    assert_eq!(a.pin, b.pin, "no-op sync must not publish another revision");
    let repo = git2::Repository::open(&desktop.0).unwrap();
    assert!(repo
        .index()
        .unwrap()
        .get_path(Path::new("Recordings/private-recording.m4a"), 0)
        .is_none());
    // Concurrent text edits preserve both contents using existing Git merge rules.
    write(&phone.0, "Feed/private-filename.md", b"phone edit\n");
    write(&desktop.0, "Feed/private-filename.md", b"desktop edit\n");
    sync_folder(&desktop.0, &state.0.join("b.json"), &mut b, &client)
        .await
        .unwrap();
    sync_folder(&phone.0, &state.0.join("a.json"), &mut a, &client)
        .await
        .unwrap();
    assert_eq!(
        fs::read(phone.0.join("Feed/private-filename.md")).unwrap(),
        b"phone edit\n"
    );
    assert_eq!(
        fs::read(phone.0.join("Feed/private-filename.conflict.md")).unwrap(),
        b"desktop edit\n"
    );
    sync_folder(&desktop.0, &state.0.join("b.json"), &mut b, &client)
        .await
        .unwrap();
    assert_eq!(
        head_commit(&git2::Repository::open(&phone.0).unwrap()),
        head_commit(&repo)
    );
    // A real deletion is carried by Git; missing audio remains archived.
    fs::remove_file(phone.0.join("Feed/private-filename.md")).unwrap();
    fs::remove_file(phone.0.join("Recordings/private-recording.m4a")).unwrap();
    sync_folder(&phone.0, &state.0.join("a.json"), &mut a, &client)
        .await
        .unwrap();
    sync_folder(&desktop.0, &state.0.join("b.json"), &mut b, &client)
        .await
        .unwrap();
    assert!(!desktop.0.join("Feed/private-filename.md").exists());
    assert!(desktop.0.join("Recordings/private-recording.m4a").exists());
    // A newly paired device reconstructs the complete incremental pack chain.
    let newcomer = Temp::new();
    let mut fresh = config(&pairing);
    sync_folder(
        &newcomer.0,
        &state.0.join("fresh.json"),
        &mut fresh,
        &client,
    )
    .await
    .unwrap();
    assert!(!newcomer.0.join("Feed/private-filename.md").exists());
    assert_eq!(
        fs::read(newcomer.0.join("Feed/private-filename.conflict.md")).unwrap(),
        b"desktop edit\n"
    );
    assert_eq!(
        fs::read(newcomer.0.join("Recordings/private-recording.m4a")).unwrap(),
        b"secret audio bytes"
    );
    // Rebuilt Git storage must not be skipped just because app-data remembers
    // successful pack imports from the previous repository.
    fs::remove_dir_all(newcomer.0.join(".git")).unwrap();
    fs::remove_dir_all(newcomer.0.join("Feed")).unwrap();
    sync_folder(
        &newcomer.0,
        &state.0.join("fresh.json"),
        &mut fresh,
        &client,
    )
    .await
    .unwrap();
    assert!(newcomer
        .0
        .join("Feed/private-filename.conflict.md")
        .exists());
    // Peer disk, including Git history, contains neither plaintext nor filenames.
    for entry in fs::read_dir(peer.0.join("objects")).unwrap() {
        let entry = entry.unwrap();
        let bytes = fs::read(entry.path()).unwrap();
        for secret in [
            b"top secret note contents".as_slice(),
            b"secret audio bytes",
            b"private-filename",
            pairing.key.as_bytes(),
        ] {
            assert!(!bytes.windows(secret.len()).any(|w| w == secret));
        }
    }
    let current = client.head().await.unwrap();
    assert!(load_manifest(&client, &pairing, &first_pin, &current)
        .await
        .err()
        .unwrap()
        .contains("rollback"));
    let mut wrong = pairing.clone();
    wrong.key = random_secret();
    assert!(load_manifest(&client, &wrong, &current, &Head::default())
        .await
        .is_err());
    drop(client);
    local.close().await;
    router.shutdown().await.unwrap();
}

#[test]
fn audio_paths_cannot_escape_root_or_follow_symlinks() {
    let root = Temp::new();
    for path in [
        "../secret",
        "Recordings/../../secret",
        "/Recordings/audio",
        "Recordings/.hidden",
        "Recordings/evil\\path",
    ] {
        assert!(audio_path(&root.0, path).is_err());
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(std::env::temp_dir(), root.0.join("Recordings")).unwrap();
        assert!(audio_path(&root.0, "Recordings/outside").is_err());
    }
}

#[test]
fn setup_generates_client_key_and_status_never_exports_it() {
    let endpoint = iroh::SecretKey::from_bytes(&[3; 32]).public().to_string();
    let code = format!(
        "{SERVER_PREFIX}{}",
        URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&ServerInvite {
                endpoint,
                token: random_secret()
            })
            .unwrap()
        )
    );
    let (pairing, create) = parse_pairing(&code).unwrap();
    assert!(create);
    let encoded = serde_json::to_string(&status(Some(&config(&pairing)))).unwrap();
    assert!(!encoded.contains(&pairing.key));
    assert!(!encoded.contains(&pairing.token));
    assert!(!encoded.contains("pairing_secret"));
    assert_ne!(parse_pairing(&code).unwrap().0.key, pairing.key);
}

#[tokio::test]
async fn concurrent_first_uploads_retry_without_losing_either_devices_notes() {
    let peer = Temp::new();
    let first = Temp::new();
    let second = Temp::new();
    let state = Temp::new();
    let token = random_secret();
    let server = endpoint().await;
    let pairing = Pairing {
        endpoint: server.id().to_string(),
        token: token.clone(),
        vault: digest(b"concurrent vault"),
        key: random_secret(),
    };
    let router = Router::builder(server)
        .accept(
            ALPN,
            MailboxProtocol::new(Store::load(&peer.0, &token, 10_000_000).unwrap()),
        )
        .spawn();
    let local = endpoint().await;
    let a_client = Client::connect_addr(&local, router.endpoint().addr(), &token)
        .await
        .unwrap();
    let b_client = Client::connect_addr(&local, router.endpoint().addr(), &token)
        .await
        .unwrap();
    let mut a = config(&pairing);
    let mut b = config(&pairing);
    write(&first.0, "Feed/a.md", b"first device\n");
    write(&second.0, "Feed/b.md", b"second device\n");
    let a_path = state.0.join("a.json");
    let b_path = state.0.join("b.json");
    let (a_result, b_result) = tokio::join!(
        sync_folder(&first.0, &a_path, &mut a, &a_client),
        sync_folder(&second.0, &b_path, &mut b, &b_client),
    );
    a_result.unwrap();
    b_result.unwrap();
    sync_folder(&first.0, &a_path, &mut a, &a_client)
        .await
        .unwrap();
    sync_folder(&second.0, &b_path, &mut b, &b_client)
        .await
        .unwrap();
    for root in [&first.0, &second.0] {
        assert_eq!(fs::read(root.join("Feed/a.md")).unwrap(), b"first device\n");
        assert_eq!(
            fs::read(root.join("Feed/b.md")).unwrap(),
            b"second device\n"
        );
    }
    // Simulate losing the local acknowledgement after a successful publication.
    let head = a.pin.clone();
    a.pin = Head::default();
    a.imported_packs.clear();
    sync_folder(&first.0, &a_path, &mut a, &a_client)
        .await
        .unwrap();
    assert_eq!(a.pin, head);
    drop(a_client);
    drop(b_client);
    local.close().await;
    router.shutdown().await.unwrap();
}

#[test]
fn git_sync_operation_lock_excludes_parallel_sync_but_is_released_on_drop() {
    let root = Temp::new();
    let guard = crate::adapters::git::lock_git_sync_operation(&root.0).unwrap();
    assert!(crate::adapters::git::lock_git_sync_operation(&root.0).is_err());
    drop(guard);
    assert!(crate::adapters::git::lock_git_sync_operation(&root.0).is_ok());
}
