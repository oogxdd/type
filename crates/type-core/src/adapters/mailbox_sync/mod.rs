//! Encrypted, asynchronous Git/audio sync. Local working trees stay plaintext.
//! Keys and rollback pins live in app-data, never inside the notes repository.
use crate::{ports::mailbox_sync::MailboxGateway, AppEnv};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use iroh::{endpoint::presets, Endpoint, EndpointId};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use type_sync_peer::{
    atomic_write, decode_secret, digest, err, open, random_secret, seal, Client, Head, MAX_OBJECT,
};

static SYNC_LOCK: Mutex<()> = Mutex::new(());
const SERVER_PREFIX: &str = "type-peer-server-v1:";
const PAIR_PREFIX: &str = "type-peer-v1:";
type Result<T> = std::result::Result<T, String>;

pub use crate::domain::mailbox_sync::{MailboxAction, MailboxStatus};
#[derive(Clone, Serialize, Deserialize)]
struct ServerInvite {
    endpoint: String,
    token: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Pairing {
    endpoint: String,
    token: String,
    vault: String,
    key: String,
}
#[derive(Serialize, Deserialize)]
struct Config {
    pairing: Pairing,
    pin: Head,
    last_sync_ms: Option<u64>,
    #[serde(default)]
    imported_packs: BTreeSet<String>,
}
#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct AudioObject {
    object: String,
    hash: String,
    size: u64,
}
#[derive(Clone, Default, Serialize, Deserialize)]
struct Manifest {
    revision: u64,
    previous: Option<String>,
    commit: Option<String>,
    packs: Vec<String>,
    audio: BTreeMap<String, AudioObject>,
}

pub struct MailboxAdapter {
    app: AppEnv,
}
impl MailboxAdapter {
    pub fn new(app: AppEnv) -> Self {
        Self { app }
    }
}
impl MailboxGateway for MailboxAdapter {
    fn execute(&self, action: MailboxAction) -> Result<MailboxStatus> {
        crate::ensure_security_unlocked_for_app(&self.app)?;
        // Snapshot the selected root before waiting behind another exchange.
        // A profile switch must not redirect an already-requested operation.
        let root = crate::ensured_notes_root(&self.app)?;
        let _guard = SYNC_LOCK.lock().map_err(err)?;
        let config_path = self.app.app_data_dir.join("mailbox").join(format!(
            "{}.json",
            digest(
                fs::canonicalize(&root)
                    .map_err(err)?
                    .to_string_lossy()
                    .as_bytes()
            )
        ));
        fs::create_dir_all(config_path.parent().unwrap()).map_err(err)?;
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(config_path.with_extension("lock"))
            .map_err(err)?;
        lock.try_lock()
            .map_err(|_| "A sync for this folder is already running")?;
        let config = match fs::read(&config_path) {
            Ok(bytes) => Some(
                serde_json::from_slice::<Config>(&bytes)
                    .map_err(|_| "Invalid local sync peer configuration")?,
            ),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(err(e)),
        };
        match action {
            MailboxAction::Status => Ok(status(config.as_ref())),
            MailboxAction::Disconnect => {
                if config.is_some() {
                    fs::remove_file(&config_path).map_err(err)?;
                }
                Ok(status(None))
            }
            MailboxAction::Pairing => {
                let config = config.ok_or("No sync peer configured")?;
                let mut result = status(Some(&config));
                result.pairing_secret = Some(format!(
                    "{PAIR_PREFIX}{}",
                    URL_SAFE_NO_PAD.encode(serde_json::to_vec(&config.pairing).map_err(err)?)
                ));
                Ok(result)
            }
            MailboxAction::Configure { secret_code } => {
                if config.is_some() {
                    return Err(
                        "Disconnect this folder's existing peer before pairing another one".into(),
                    );
                }
                let (pairing, create) = parse_pairing(&secret_code)?;
                let runtime = tokio::runtime::Runtime::new().map_err(err)?;
                let pin = runtime.block_on(async {
                    let endpoint = Endpoint::builder(presets::N0).bind().await.map_err(err)?;
                    let result: Result<_> = async {
                        let client = Client::connect(&endpoint, pairing.endpoint.parse::<EndpointId>().map_err(err)?, &pairing.token).await?;
                        let head = client.head().await?;
                        if create && head.revision != 0 { return Err("Peer already contains a vault. Use the pairing code from an existing device".into()); }
                        load_manifest(&client, &pairing, &head, &Head::default()).await?;
                        Ok(head)
                    }.await;
                    endpoint.close().await;
                    result
                })?;
                let config = Config {
                    pairing,
                    pin,
                    last_sync_ms: None,
                    imported_packs: BTreeSet::new(),
                };
                save_config(&config_path, &config)?;
                Ok(status(Some(&config)))
            }
            MailboxAction::Sync => {
                let mut config = config.ok_or("No sync peer configured")?;
                let runtime = tokio::runtime::Runtime::new().map_err(err)?;
                runtime.block_on(async {
                    let endpoint = Endpoint::builder(presets::N0).bind().await.map_err(err)?;
                    let result: Result<_> = async {
                        let client = Client::connect(
                            &endpoint,
                            config.pairing.endpoint.parse::<EndpointId>().map_err(err)?,
                            &config.pairing.token,
                        )
                        .await?;
                        sync_folder(&root, &config_path, &mut config, &client).await
                    }
                    .await;
                    endpoint.close().await;
                    result
                })?;
                Ok(status(Some(&config)))
            }
        }
    }
}
fn status(config: Option<&Config>) -> MailboxStatus {
    MailboxStatus {
        enabled: config.is_some(),
        endpoint: config.map(|c| c.pairing.endpoint.clone()),
        revision: config.map_or(0, |c| c.pin.revision),
        last_sync_ms: config.and_then(|c| c.last_sync_ms),
        pairing_secret: None,
    }
}
fn save_config(path: &Path, config: &Config) -> Result<()> {
    atomic_write(path, &serde_json::to_vec(config).map_err(err)?)
}
fn parse_pairing(code: &str) -> Result<(Pairing, bool)> {
    let code = code.trim();
    if code.len() > 4096 {
        return Err("Pairing code is too long".into());
    }
    let (pairing, create) = if let Some(value) = code.strip_prefix(SERVER_PREFIX) {
        let bytes = URL_SAFE_NO_PAD
            .decode(value)
            .map_err(|_| "Invalid server code")?;
        let invite: ServerInvite =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid server code")?;
        (
            Pairing {
                endpoint: invite.endpoint,
                token: invite.token,
                vault: digest(random_secret().as_bytes()),
                key: random_secret(),
            },
            true,
        )
    } else if let Some(value) = code.strip_prefix(PAIR_PREFIX) {
        let bytes = URL_SAFE_NO_PAD
            .decode(value)
            .map_err(|_| "Invalid device pairing code")?;
        (
            serde_json::from_slice::<Pairing>(&bytes).map_err(|_| "Invalid device pairing code")?,
            false,
        )
    } else {
        return Err("Paste a Type sync peer setup or device pairing code".into());
    };
    pairing
        .endpoint
        .parse::<EndpointId>()
        .map_err(|_| "Invalid peer identity")?;
    decode_secret(&pairing.token)?;
    decode_secret(&pairing.key)?;
    if !type_sync_peer::valid_id(&pairing.vault) {
        return Err("Invalid vault id".into());
    }
    Ok((pairing, create))
}
async fn read_manifest(client: &Client, pairing: &Pairing, id: &str) -> Result<Manifest> {
    let encrypted = client.get(id).await?;
    if encrypted.len() > 8 * 1024 * 1024 {
        return Err("Sync manifest exceeds 8 MiB".into());
    }
    let bytes = open(
        &decode_secret(&pairing.key)?,
        &pairing.vault,
        "manifest",
        &encrypted,
    )?;
    serde_json::from_slice(&bytes).map_err(|_| "Invalid encrypted sync manifest".into())
}
async fn load_manifest(
    client: &Client,
    pairing: &Pairing,
    head: &Head,
    pin: &Head,
) -> Result<Manifest> {
    if head.revision < pin.revision || (head.revision == pin.revision && head != pin) {
        return Err("Peer rollback detected; refusing older or replaced data".into());
    }
    if head.revision == 0 {
        if head != &Head::default() {
            return Err("Invalid empty peer state".into());
        }
        return Ok(Manifest::default());
    }
    if head.vault.as_deref() != Some(&pairing.vault) {
        return Err("This peer contains a different vault".into());
    }
    let mut id = head.object.clone().ok_or("Missing manifest")?;
    let latest = read_manifest(client, pairing, &id).await?;
    if latest.revision != head.revision {
        return Err("Invalid manifest revision".into());
    }
    // Authenticate the chain down to our locally remembered head. The peer
    // cannot replace an acknowledged history with an unrelated valid object.
    if pin.revision > 0 && head.revision > pin.revision {
        if head.revision - pin.revision > 4096 {
            return Err("More than 4096 unseen revisions; restore from a trusted device".into());
        }
        let mut cursor = latest.clone();
        while cursor.revision > pin.revision {
            id = cursor.previous.ok_or("Broken manifest chain")?;
            let expected = cursor.revision - 1;
            if expected == pin.revision {
                if Some(&id) != pin.object.as_ref() {
                    return Err(
                        "Peer history does not extend this device's acknowledged history".into(),
                    );
                }
                break;
            }
            cursor = read_manifest(client, pairing, &id).await?;
            if cursor.revision != expected {
                return Err("Broken manifest sequence".into());
            }
        }
    }
    Ok(latest)
}
async fn upload(client: &Client, pairing: &Pairing, kind: &str, bytes: &[u8]) -> Result<String> {
    client
        .put(&seal(
            &decode_secret(&pairing.key)?,
            &pairing.vault,
            kind,
            bytes,
        )?)
        .await
}
async fn download(client: &Client, pairing: &Pairing, kind: &str, id: &str) -> Result<Vec<u8>> {
    open(
        &decode_secret(&pairing.key)?,
        &pairing.vault,
        kind,
        &client.get(id).await?,
    )
}

fn pack_history(repo: &git2::Repository, base: Option<&str>) -> Result<Vec<u8>> {
    let mut walk = repo.revwalk().map_err(err)?;
    walk.push_head().map_err(err)?;
    if let Some(base) = base {
        walk.hide(git2::Oid::from_str(base).map_err(err)?)
            .map_err(err)?;
    }
    let mut builder = repo.packbuilder().map_err(err)?;
    builder.insert_walk(&mut walk).map_err(err)?;
    let mut bytes = Vec::new();
    let mut exceeded = false;
    let result = builder.foreach(|chunk| {
        if bytes.len() + chunk.len() > MAX_OBJECT - 44 {
            exceeded = true;
            false
        } else {
            bytes.extend_from_slice(chunk);
            true
        }
    });
    if exceeded {
        return Err("Git history exceeds 256 MiB. Migrate legacy audio out of Git before using the sync peer".into());
    }
    result.map_err(err)?;
    Ok(bytes)
}
fn import_history(repo: &git2::Repository, bytes: &[u8]) -> Result<()> {
    let odb = repo.odb().map_err(err)?;
    let mut writer = odb.packwriter().map_err(err)?;
    writer.write_all(bytes).map_err(err)?;
    writer.commit().map(|_| ()).map_err(err)
}
fn head_commit(repo: &git2::Repository) -> Option<String> {
    repo.head().ok()?.target().map(|id| id.to_string())
}
fn merge_history(repo: &git2::Repository, branch: &str, commit: &str) -> Result<()> {
    let id = git2::Oid::from_str(commit).map_err(err)?;
    let fetched = repo.find_annotated_commit(id).map_err(err)?;
    let (analysis, _) = repo.merge_analysis(&[&fetched]).map_err(err)?;
    if analysis.is_up_to_date() {
        return Ok(());
    }
    if analysis.is_fast_forward() || analysis.is_unborn() {
        let target = repo.find_commit(id).map_err(err)?;
        // Check out safely before advancing HEAD, so a concurrent local edit
        // that rejects checkout cannot leave the branch at an unapplied commit.
        repo.checkout_tree(
            target.as_object(),
            Some(git2::build::CheckoutBuilder::new().safe()),
        )
        .map_err(err)?;
        let reference = format!("refs/heads/{branch}");
        repo.reference(&reference, id, true, "Encrypted peer fast-forward")
            .map_err(err)?;
        repo.set_head(&reference).map_err(err)
    } else {
        crate::merge_fetched_commit(repo, branch, &fetched)
    }
}

fn audio_path(root: &Path, relative: &str) -> Result<PathBuf> {
    if relative.contains('\\') || relative.contains('\0') || !relative.starts_with("Recordings/") {
        return Err("Invalid audio path in manifest".into());
    }
    let mut path = root.to_path_buf();
    for component in Path::new(relative).components() {
        let Component::Normal(name) = component else {
            return Err("Unsafe audio path in manifest".into());
        };
        if name.to_string_lossy().starts_with('.') {
            return Err("Hidden audio path in manifest".into());
        }
        path.push(name);
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err("Sync does not follow audio symlinks".into())
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(err(e)),
        }
    }
    Ok(path)
}
fn collect_audio(root: &Path, dir: &Path, files: &mut Vec<String>) -> Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    if fs::symlink_metadata(dir)
        .map_err(err)?
        .file_type()
        .is_symlink()
    {
        return Err("Sync does not follow audio symlinks".into());
    }
    for entry in fs::read_dir(dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let kind = entry.file_type().map_err(err)?;
        if kind.is_symlink() {
            return Err("Sync does not follow audio symlinks".into());
        }
        if kind.is_dir() {
            collect_audio(root, &entry.path(), files)?;
        } else if kind.is_file() {
            files.push(
                entry
                    .path()
                    .strip_prefix(root)
                    .map_err(err)?
                    .to_str()
                    .ok_or("Non UTF-8 audio filename")?
                    .replace('\\', "/"),
            );
        }
    }
    Ok(())
}
async fn sync_audio(
    root: &Path,
    client: &Client,
    pairing: &Pairing,
    audio: &mut BTreeMap<String, AudioObject>,
) -> Result<()> {
    let mut files = Vec::new();
    collect_audio(root, &root.join("Recordings"), &mut files)?;
    for relative in files {
        let path = audio_path(root, &relative)?;
        if fs::metadata(&path).map_err(err)?.len() > (MAX_OBJECT - 44) as u64 {
            return Err("An audio file exceeds the 256 MiB sync limit".into());
        }
        let bytes = fs::read(path).map_err(err)?;
        let hash = digest(&bytes);
        if let Some(existing) = audio.get(&relative) {
            if existing.hash != hash {
                return Err("An audio filename has different contents on two devices; rename one copy before syncing".into());
            }
        } else {
            let object = upload(client, pairing, "audio", &bytes).await?;
            audio.insert(
                relative,
                AudioObject {
                    object,
                    hash,
                    size: bytes.len() as u64,
                },
            );
        }
    }
    // Audio is append-only in v1: local cache eviction is never a remote deletion.
    // No desktop-durability receipt is forged just because a mailbox accepted it.
    for (relative, item) in audio.iter() {
        let path = audio_path(root, relative)?;
        if path.exists() {
            continue;
        }
        let bytes = download(client, pairing, "audio", &item.object).await?;
        if bytes.len() as u64 != item.size || digest(&bytes) != item.hash {
            return Err("Audio content verification failed".into());
        }
        // Recheck after the network await; do not overwrite newly recorded audio.
        let path = audio_path(root, relative)?;
        if path.exists() {
            return Err("Audio changed during sync; retry".into());
        }
        atomic_write(&path, &bytes)?;
    }
    Ok(())
}

async fn sync_folder(
    root: &Path,
    config_path: &Path,
    config: &mut Config,
    client: &Client,
) -> Result<()> {
    let _operation = crate::adapters::git::lock_git_sync_operation(root)?;
    for _ in 0..4 {
        let before = client.head().await?;
        let remote = load_manifest(client, &config.pairing, &before, &config.pin).await?;
        let repo = crate::ensure_git_repo(root)?;
        crate::set_audio_git_exclusion(&repo, true)?;
        let branch = crate::resolve_target_branch(&repo, None);
        crate::switch_or_prepare_branch(&repo, &branch)?;
        // Authenticate/reach the peer first. Offline retries create no commits.
        if let Some(commit) = &remote.commit {
            if repo
                .find_commit(git2::Oid::from_str(commit).map_err(err)?)
                .is_err()
            {
                for pack in &remote.packs {
                    if !config.imported_packs.contains(pack) {
                        import_history(
                            &repo,
                            &download(client, &config.pairing, "git-pack", pack).await?,
                        )?;
                        config.imported_packs.insert(pack.clone());
                    }
                }
                // App-data can survive a deleted/rebuilt .git directory. A
                // cached import receipt is not proof that its objects remain.
                if repo
                    .find_commit(git2::Oid::from_str(commit).map_err(err)?)
                    .is_err()
                {
                    for pack in &remote.packs {
                        import_history(
                            &repo,
                            &download(client, &config.pairing, "git-pack", pack).await?,
                        )?;
                    }
                }
            }
        }
        // Network downloads precede the checkpoint: edits saved during the
        // download are included before the synchronous merge/checkout phase.
        crate::commit_all_changes(&repo, "Sync peer checkpoint", &branch)?;
        if let Some(commit) = &remote.commit {
            #[cfg(desktop)]
            let before_merge = head_commit(&repo);
            merge_history(&repo, &branch, commit)?;
            // Incoming notes are visible even if the subsequent upload fails.
            #[cfg(desktop)]
            if head_commit(&repo) != before_merge {
                crate::adapters::local_sync::notify_local_sync_push_received();
            }
        }
        let commit = head_commit(&repo);
        let mut packs = remote.packs.clone();
        if commit != remote.commit && commit.is_some() {
            let pack = upload(
                client,
                &config.pairing,
                "git-pack",
                &pack_history(&repo, remote.commit.as_deref())?,
            )
            .await?;
            config.imported_packs.insert(pack.clone());
            packs.push(pack);
        }
        let mut audio = remote.audio.clone();
        sync_audio(root, client, &config.pairing, &mut audio).await?;
        if before.revision > 0 && commit == remote.commit && audio == remote.audio {
            config.pin = before;
        } else {
            let revision = before.revision.checked_add(1).ok_or("Revision overflow")?;
            let manifest = Manifest {
                revision,
                previous: before.object.clone(),
                commit,
                packs,
                audio,
            };
            let bytes = serde_json::to_vec(&manifest).map_err(err)?;
            if bytes.len() > 8 * 1024 * 1024 - 44 {
                return Err("Sync manifest exceeds 8 MiB".into());
            }
            let object = upload(client, &config.pairing, "manifest", &bytes).await?;
            if !client
                .publish(&before, &object, &config.pairing.vault)
                .await?
            {
                continue;
            }
            config.pin = Head {
                revision,
                object: Some(object),
                vault: Some(config.pairing.vault.clone()),
            };
        }
        config.last_sync_ms = crate::now_ms().and_then(|time| u64::try_from(time).ok());
        save_config(config_path, config)?;
        return Ok(());
    }
    Err("Other devices kept updating the peer; retry sync".into())
}

#[cfg(test)]
mod tests;
