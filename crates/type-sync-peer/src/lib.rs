//! Single-vault persistent mailbox. The server only handles opaque ciphertext.
//! Transport authentication is deliberately independent of the client vault key.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use iroh::{
    endpoint::{Connection, RecvStream, SendStream},
    protocol::{AcceptError, ProtocolHandler},
    Endpoint, EndpointId,
};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use subtle::ConstantTimeEq;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const ALPN: &[u8] = b"type/encrypted-mailbox/1";
pub const MAX_OBJECT: usize = 256 * 1024 * 1024;
const MAX_HEADER: usize = 16 * 1024;
const TIMEOUT: Duration = Duration::from_secs(180);
pub type Result<T> = std::result::Result<T, String>;
pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn random_secret() -> String {
    let mut bytes = [0; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
pub fn decode_secret(value: &str) -> Result<[u8; 32]> {
    URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| "Invalid secret encoding".to_string())?
        .try_into()
        .map_err(|_| "A secret must contain 32 random bytes".into())
}
pub fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

/// AEAD context prevents swapping an audio object, Git pack, or manifest across vaults.
/// A random nonce makes ciphertext hashes reveal no hashes of plaintext.
pub fn seal(key: &[u8; 32], vault: &str, kind: &str, plaintext: &[u8]) -> Result<Vec<u8>> {
    if plaintext.len() > MAX_OBJECT - 44 {
        return Err("Sync object exceeds the 256 MiB limit".into());
    }
    let mut nonce = [0; 24];
    OsRng.fill_bytes(&mut nonce);
    let aad = format!("type-mailbox-v1/{vault}/{kind}");
    let encrypted = XChaCha20Poly1305::new(key.into())
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| "Could not encrypt sync object")?;
    let mut out = b"TMB1".to_vec();
    out.extend(nonce);
    out.extend(encrypted);
    Ok(out)
}
pub fn open(key: &[u8; 32], vault: &str, kind: &str, ciphertext: &[u8]) -> Result<Vec<u8>> {
    if ciphertext.len() < 44 || ciphertext.len() > MAX_OBJECT || &ciphertext[..4] != b"TMB1" {
        return Err("Invalid encrypted sync object".into());
    }
    let aad = format!("type-mailbox-v1/{vault}/{kind}");
    XChaCha20Poly1305::new(key.into())
        .decrypt(
            XNonce::from_slice(&ciphertext[4..28]),
            Payload {
                msg: &ciphertext[28..],
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| "Sync authentication failed: wrong vault key or modified data".into())
}

/// Atomic and durable publication. Temporary files have restrictive permissions.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("Missing parent directory")?;
    fs::create_dir_all(parent).map_err(err)?;
    let temp = parent.join(format!(".tmp-{}", random_secret()));
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let result = (|| {
        let mut file = opts.open(&temp).map_err(err)?;
        file.write_all(bytes).map_err(err)?;
        file.sync_all().map_err(err)?;
        fs::rename(&temp, path).map_err(err)?;
        #[cfg(unix)]
        File::open(parent).and_then(|f| f.sync_all()).map_err(err)?;
        Ok(())
    })();
    let _ = fs::remove_file(temp);
    result
}

#[derive(Clone, Default, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Head {
    pub revision: u64,
    pub object: Option<String>,
    pub vault: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Request {
    Head {
        token: String,
    },
    Get {
        token: String,
        id: String,
    },
    Put {
        token: String,
        id: String,
        size: usize,
    },
    Publish {
        token: String,
        expected: Head,
        object: String,
        vault: String,
    },
}
impl Request {
    fn token(&self) -> &str {
        match self {
            Self::Head { token }
            | Self::Get { token, .. }
            | Self::Put { token, .. }
            | Self::Publish { token, .. } => token,
        }
    }
}
#[derive(Serialize, Deserialize)]
struct Response {
    error: Option<String>,
    head: Option<Head>,
    size: usize,
    accepted: bool,
}
impl Response {
    fn ok() -> Self {
        Self {
            error: None,
            head: None,
            size: 0,
            accepted: true,
        }
    }
}

#[derive(Debug)]
pub struct Store {
    root: PathBuf,
    token: [u8; 32],
    quota: u64,
    used: u64,
    _lock: File,
}
impl Store {
    pub fn load(root: &Path, token: &str, quota: u64) -> Result<Self> {
        fs::create_dir_all(root.join("objects")).map_err(err)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(root.join("peer.lock"))
            .map_err(err)?;
        lock.try_lock()
            .map_err(|_| "Another peer already owns this directory")?;
        let used = fs::read_dir(root.join("objects")).map_err(err)?.try_fold(
            0u64,
            |total, entry| -> Result<u64> {
                Ok(total + entry.map_err(err)?.metadata().map_err(err)?.len())
            },
        )?;
        Ok(Self {
            root: root.into(),
            token: decode_secret(token)?,
            quota,
            used,
            _lock: lock,
        })
    }
    fn authorize(&self, token: &str) -> Result<()> {
        let supplied = decode_secret(token).map_err(|_| "Access denied".to_string())?;
        if bool::from(self.token.ct_eq(&supplied)) {
            Ok(())
        } else {
            Err("Access denied".into())
        }
    }
    fn path(&self, id: &str) -> Result<PathBuf> {
        if !valid_id(id) {
            return Err("Invalid object id".into());
        }
        Ok(self.root.join("objects").join(id))
    }
    pub fn head(&self) -> Result<Head> {
        match fs::read(self.root.join("head.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(err),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Head::default()),
            Err(e) => Err(err(e)),
        }
    }
    pub fn get(&self, id: &str) -> Result<Vec<u8>> {
        let path = self.path(id)?;
        if fs::metadata(&path).map_err(err)?.len() > MAX_OBJECT as u64 {
            return Err("Object too large".into());
        }
        fs::read(path).map_err(err)
    }
    pub fn put(&mut self, id: &str, bytes: &[u8]) -> Result<()> {
        let path = self.path(id)?;
        if bytes.len() < 44
            || bytes.len() > MAX_OBJECT
            || &bytes[..4] != b"TMB1"
            || digest(bytes) != id
        {
            return Err("Invalid ciphertext object".into());
        }
        if path.exists() {
            return Ok(());
        }
        if self.used.saturating_add(bytes.len() as u64) > self.quota {
            return Err("Peer storage quota exceeded".into());
        }
        atomic_write(&path, bytes)?;
        self.used += bytes.len() as u64;
        Ok(())
    }
    pub fn publish(&mut self, expected: &Head, object: &str, vault: &str) -> Result<bool> {
        let current = self.head()?;
        if &current != expected {
            return Ok(false);
        }
        if !valid_id(vault) || current.vault.as_deref().is_some_and(|v| v != vault) {
            return Err("This peer already belongs to another vault".into());
        }
        if !self.path(object)?.is_file() {
            return Err("Manifest was not uploaded".into());
        }
        let revision = current.revision.checked_add(1).ok_or("Revision overflow")?;
        atomic_write(
            &self.root.join("head.json"),
            &serde_json::to_vec(&Head {
                revision,
                object: Some(object.into()),
                vault: Some(vault.into()),
            })
            .map_err(err)?,
        )?;
        Ok(true)
    }
}

async fn write_json<T: Serialize>(send: &mut SendStream, value: &T) -> Result<()> {
    let bytes = serde_json::to_vec(value).map_err(err)?;
    if bytes.len() > MAX_HEADER {
        return Err("Header too large".into());
    }
    send.write_u32(bytes.len() as u32).await.map_err(err)?;
    send.write_all(&bytes).await.map_err(err)
}
async fn read_json<T: for<'de> Deserialize<'de>>(recv: &mut RecvStream) -> Result<T> {
    let size = recv.read_u32().await.map_err(err)? as usize;
    if size > MAX_HEADER {
        return Err("Header too large".into());
    }
    let mut bytes = vec![0; size];
    recv.read_exact(&mut bytes).await.map_err(err)?;
    serde_json::from_slice(&bytes).map_err(|_| "Invalid mailbox header".into())
}

#[derive(Clone, Debug)]
pub struct MailboxProtocol {
    store: Arc<Mutex<Store>>,
    slots: Arc<tokio::sync::Semaphore>,
    transfers: Arc<tokio::sync::Semaphore>,
}
impl MailboxProtocol {
    pub fn new(store: Store) -> Self {
        Self {
            store: Arc::new(Mutex::new(store)),
            slots: Arc::new(tokio::sync::Semaphore::new(8)),
            transfers: Arc::new(tokio::sync::Semaphore::new(1)),
        }
    }
    async fn request(&self, send: &mut SendStream, recv: &mut RecvStream) -> Result<()> {
        let request: Request = read_json(recv).await?;
        self.store.lock().map_err(err)?.authorize(request.token())?;
        // Bound peak memory on small VPS instances independently of idle
        // connections. Only authenticated requests may reserve a transfer slot.
        let _transfer = if matches!(&request, Request::Get { .. } | Request::Put { .. }) {
            Some(self.transfers.acquire().await.map_err(err)?)
        } else {
            None
        };
        let mut response = Response::ok();
        let mut payload = Vec::new();
        match request {
            Request::Head { .. } => response.head = Some(self.store.lock().map_err(err)?.head()?),
            Request::Get { id, .. } => {
                payload = self.store.lock().map_err(err)?.get(&id)?;
                response.size = payload.len();
            }
            Request::Put { id, size, .. } => {
                if !(44..=MAX_OBJECT).contains(&size) || !valid_id(&id) {
                    return Err("Invalid upload size or id".into());
                }
                // Authenticate before allocating/accepting any object bytes.
                write_json(send, &response).await?;
                let mut bytes = vec![0; size];
                recv.read_exact(&mut bytes).await.map_err(err)?;
                self.store.lock().map_err(err)?.put(&id, &bytes)?;
            }
            Request::Publish {
                expected,
                object,
                vault,
                ..
            } => {
                response.accepted = self
                    .store
                    .lock()
                    .map_err(err)?
                    .publish(&expected, &object, &vault)?
            }
        }
        write_json(send, &response).await?;
        send.write_all(&payload).await.map_err(err)?;
        send.finish().map_err(err)?;
        Ok(())
    }
}
impl ProtocolHandler for MailboxProtocol {
    async fn accept(&self, connection: Connection) -> std::result::Result<(), AcceptError> {
        let Ok(_permit) = self.slots.clone().try_acquire_owned() else {
            connection.close(1u32.into(), b"Busy");
            return Ok(());
        };
        // Keep the handler alive for the lifetime of the connection, including
        // final stream delivery. One client can issue many sequential requests.
        while let Ok(Ok((mut send, mut recv))) =
            tokio::time::timeout(TIMEOUT, connection.accept_bi()).await
        {
            let result = tokio::time::timeout(TIMEOUT, self.request(&mut send, &mut recv)).await;
            if !matches!(result, Ok(Ok(()))) {
                let message = match result {
                    Ok(Err(e)) => e,
                    _ => "Mailbox request timed out".into(),
                };
                let _ = write_json(
                    &mut send,
                    &Response {
                        error: Some(message),
                        ..Response::ok()
                    },
                )
                .await;
                let _ = send.finish();
            }
        }
        connection.close(0u32.into(), b"Done");
        Ok(())
    }
}

pub struct Client {
    connection: Connection,
    token: String,
}
impl Client {
    pub async fn connect(endpoint: &Endpoint, peer: EndpointId, token: &str) -> Result<Self> {
        Self::connect_addr(endpoint, peer.into(), token).await
    }
    pub async fn connect_addr(
        endpoint: &Endpoint,
        peer: iroh::EndpointAddr,
        token: &str,
    ) -> Result<Self> {
        decode_secret(token)?;
        let connection =
            tokio::time::timeout(Duration::from_secs(30), endpoint.connect(peer, ALPN))
                .await
                .map_err(|_| "Sync peer is unavailable")?
                .map_err(|_| "Could not connect to sync peer")?;
        Ok(Self {
            connection,
            token: token.into(),
        })
    }
    async fn exchange(
        &self,
        request: Request,
        upload: Option<&[u8]>,
    ) -> Result<(Response, Vec<u8>)> {
        tokio::time::timeout(TIMEOUT, async {
            let (mut send, mut recv) = self.connection.open_bi().await.map_err(err)?;
            write_json(&mut send, &request).await?;
            if let Some(bytes) = upload {
                let ready: Response = read_json(&mut recv).await?;
                if let Some(error) = ready.error {
                    return Err(error);
                }
                send.write_all(bytes).await.map_err(err)?;
            }
            send.finish().map_err(err)?;
            let response: Response = read_json(&mut recv).await?;
            if let Some(error) = &response.error {
                return Err(error.clone());
            }
            if response.size > MAX_OBJECT {
                return Err("Peer response too large".into());
            }
            let mut bytes = vec![0; response.size];
            recv.read_exact(&mut bytes).await.map_err(err)?;
            Ok((response, bytes))
        })
        .await
        .map_err(|_| "Sync peer request timed out".to_string())?
    }
    pub async fn head(&self) -> Result<Head> {
        self.exchange(
            Request::Head {
                token: self.token.clone(),
            },
            None,
        )
        .await?
        .0
        .head
        .ok_or("Missing peer head".into())
    }
    pub async fn get(&self, id: &str) -> Result<Vec<u8>> {
        if !valid_id(id) {
            return Err("Invalid object id".into());
        }
        let bytes = self
            .exchange(
                Request::Get {
                    token: self.token.clone(),
                    id: id.into(),
                },
                None,
            )
            .await?
            .1;
        if digest(&bytes) != id {
            return Err("Peer returned modified ciphertext".into());
        }
        Ok(bytes)
    }
    pub async fn put(&self, bytes: &[u8]) -> Result<String> {
        if bytes.len() > MAX_OBJECT {
            return Err("Sync object exceeds 256 MiB".into());
        }
        let id = digest(bytes);
        self.exchange(
            Request::Put {
                token: self.token.clone(),
                id: id.clone(),
                size: bytes.len(),
            },
            Some(bytes),
        )
        .await?;
        Ok(id)
    }
    pub async fn publish(&self, expected: &Head, object: &str, vault: &str) -> Result<bool> {
        Ok(self
            .exchange(
                Request::Publish {
                    token: self.token.clone(),
                    expected: expected.clone(),
                    object: object.into(),
                    vault: vault.into(),
                },
                None,
            )
            .await?
            .0
            .accepted)
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        self.connection.close(0u32.into(), b"Done");
    }
}

#[cfg(test)]
mod tests;
