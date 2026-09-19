use super::*;
use iroh::{endpoint::presets, protocol::Router};

fn temp() -> PathBuf {
    let path = std::env::temp_dir().join(format!("type-mailbox-{}", random_secret()));
    fs::create_dir_all(&path).unwrap();
    path
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

#[test]
fn ciphertext_authenticates_every_context_and_randomizes_identical_content() {
    let key = decode_secret(&random_secret()).unwrap();
    let data = b"private-filename.md and secret note contents";
    let sealed = seal(&key, "vault-a", "git-pack", data).unwrap();
    assert_eq!(open(&key, "vault-a", "git-pack", &sealed).unwrap(), data);
    assert_ne!(sealed, seal(&key, "vault-a", "git-pack", data).unwrap());
    assert!(!sealed.windows(data.len()).any(|w| w == data));
    assert!(open(&[0; 32], "vault-a", "git-pack", &sealed).is_err());
    assert!(open(&key, "vault-b", "git-pack", &sealed).is_err());
    assert!(open(&key, "vault-a", "audio", &sealed).is_err());
    let mut modified = sealed.clone();
    modified[35] ^= 1;
    assert!(open(&key, "vault-a", "git-pack", &modified).is_err());
    for length in 0..44 {
        assert!(open(&key, "vault-a", "git-pack", &sealed[..length]).is_err());
    }
}

#[test]
fn durable_cas_quota_and_single_owner() {
    let root = temp();
    let token = random_secret();
    let vault = digest(b"vault");
    let bytes = seal(&[5; 32], &vault, "manifest", b"first").unwrap();
    let id = digest(&bytes);
    let mut store = Store::load(&root, &token, bytes.len() as u64).unwrap();
    assert!(Store::load(&root, &token, 10000).is_err());
    assert!(store.get("../peer.json").is_err());
    assert!(store.put(&id, b"plaintext").is_err());
    store.put(&id, &bytes).unwrap();
    store.put(&id, &bytes).unwrap();
    let other = seal(&[5; 32], &vault, "manifest", b"second").unwrap();
    assert!(store.put(&digest(&other), &other).is_err());
    assert!(store.publish(&Head::default(), &id, &vault).unwrap());
    assert!(!store.publish(&Head::default(), &id, &vault).unwrap());
    assert!(store
        .publish(&store.head().unwrap(), &id, &digest(b"different vault"))
        .is_err());
    let head = store.head().unwrap();
    drop(store);
    let reopened = Store::load(&root, &token, 10000).unwrap();
    assert_eq!(reopened.head().unwrap(), head);
    assert_eq!(reopened.get(&id).unwrap(), bytes);
    drop(reopened);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn one_authenticated_connection_serves_multiple_durable_requests() {
    let root = temp();
    let token = random_secret();
    let server = endpoint().await;
    let router = Router::builder(server)
        .accept(
            ALPN,
            MailboxProtocol::new(Store::load(&root, &token, 100000).unwrap()),
        )
        .spawn();
    let local = endpoint().await;
    let denied = Client::connect_addr(&local, router.endpoint().addr(), &random_secret())
        .await
        .unwrap();
    assert!(denied.head().await.unwrap_err().contains("Access denied"));
    drop(denied);
    let client = Client::connect_addr(&local, router.endpoint().addr(), &token)
        .await
        .unwrap();
    assert_eq!(client.head().await.unwrap(), Head::default());
    let bytes = seal(&[8; 32], "vault", "manifest", b"secret").unwrap();
    let id = client.put(&bytes).await.unwrap();
    assert_eq!(client.get(&id).await.unwrap(), bytes);
    assert!(client
        .publish(&Head::default(), &id, &digest(b"vault"))
        .await
        .unwrap());
    assert_eq!(client.head().await.unwrap().revision, 1);
    drop(client);
    local.close().await;
    router.shutdown().await.unwrap();
    fs::remove_dir_all(root).unwrap();
}
