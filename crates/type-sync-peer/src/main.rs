use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use iroh::{endpoint::presets, protocol::Router, Endpoint, SecretKey};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use type_sync_peer::{
    atomic_write, decode_secret, err, random_secret, MailboxProtocol, Store, ALPN,
};

#[derive(Serialize, Deserialize)]
struct Config {
    endpoint_secret: String,
    access_token: String,
    quota_bytes: u64,
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
async fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 3 || !matches!(args[1].as_str(), "init" | "serve") {
        return Err("Usage: type-sync-peer <init|serve> <data-directory>".into());
    }
    let root = PathBuf::from(&args[2]);
    let config_path = root.join("peer.json");
    if args[1] == "init" && !config_path.exists() {
        atomic_write(
            &config_path,
            &serde_json::to_vec(&Config {
                endpoint_secret: random_secret(),
                access_token: random_secret(),
                quota_bytes: 10 * 1024 * 1024 * 1024,
            })
            .map_err(err)?,
        )?;
    }
    let config: Config =
        serde_json::from_slice(&std::fs::read(config_path).map_err(err)?).map_err(err)?;
    let secret = SecretKey::from_bytes(&decode_secret(&config.endpoint_secret)?);
    if args[1] == "init" {
        let invite = serde_json::json!({ "endpoint": secret.public().to_string(), "token": config.access_token });
        println!(
            "type-peer-server-v1:{}",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&invite).map_err(err)?)
        );
        return Ok(());
    }
    let store = Store::load(&root, &config.access_token, config.quota_bytes)?;
    let endpoint = Endpoint::builder(presets::N0)
        .secret_key(secret)
        .bind()
        .await
        .map_err(err)?;
    eprintln!("Type encrypted sync peer: {}", endpoint.id());
    let router = Router::builder(endpoint)
        .accept(ALPN, MailboxProtocol::new(store))
        .spawn();
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .map_err(err)?;
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c().await.map_err(err)?;
    router.shutdown().await.map_err(err)
}
