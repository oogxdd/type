//! End-to-end encryption for object sync.
//!
//! What the bucket holds is ciphertext under opaque keys; what it never holds
//! is anything that can derive a key.
//!
//! ```text
//!   passphrase --Argon2id--> KEK --wraps--> vault key (random, 256-bit)
//!                                              |
//!                                     HKDF-SHA256 splits into
//!                                              |
//!                            k_name / k_content / k_manifest
//! ```
//!
//! Wrapping rather than deriving the data key straight from the passphrase is
//! what makes "change my phrase" re-encrypt 32 bytes instead of every note.
//!
//! **Threat model.** This protects against the storage provider and anyone on
//! the network. It does not protect a device someone already has — the vault
//! key sits beside the bucket credentials in the working folder's device-local
//! `.type/device.json`, and anyone who can read that file can read the bucket
//! anyway. Local-disk protection is the app lock's job, and the OS's.

use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    Key, XChaCha20Poly1305, XNonce,
};
use hmac::{Hmac, Mac};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop};

type HmacSha256 = Hmac<Sha256>;

const KEY_SIZE: usize = 32;
const NONCE_SIZE: usize = 24;
const SALT_SIZE: usize = 16;

/// Envelope prefix, so a payload that is not ours fails loudly instead of
/// being fed to the AEAD as garbage.
const BLOB_MAGIC: &[u8; 8] = b"TYPEBLB1";

/// Argon2id cost for the key-wrapping KEK. Heavier than the app-lock defaults
/// because this runs once per device rather than on every unlock; 64 MiB stays
/// within reach of the phones the app targets.
const KDF_M_COST: u32 = 65_536; // KiB
const KDF_T_COST: u32 = 3;
const KDF_P_COST: u32 = 1;

// ── Key material ───────────────────────────────────────────────────────────────

/// The 256-bit root key. Zeroized on drop; never serialized except wrapped.
#[derive(Clone, ZeroizeOnDrop)]
pub struct VaultKey([u8; KEY_SIZE]);

/// Written by hand rather than derived so a stray `{:?}` — in a log line, a
/// panic message, an error report — cannot print the key.
impl std::fmt::Debug for VaultKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("VaultKey(<redacted>)")
    }
}

impl VaultKey {
    pub fn generate() -> Self {
        let mut bytes = [0u8; KEY_SIZE];
        OsRng.fill_bytes(&mut bytes);
        Self(bytes)
    }

    /// Decode a key persisted in this device's settings.
    pub fn from_base64(encoded: &str) -> Result<Self, String> {
        let raw = BASE64
            .decode(encoded.trim())
            .map_err(|error| format!("Invalid vault key: {error}"))?;
        let bytes: [u8; KEY_SIZE] = raw
            .as_slice()
            .try_into()
            .map_err(|_| "Vault key must be 32 bytes.".to_string())?;
        Ok(Self(bytes))
    }

    pub fn to_base64(&self) -> String {
        BASE64.encode(self.0)
    }

    /// The three purpose-separated subkeys. Deriving rather than reusing the
    /// root means no key is ever used for two jobs.
    pub fn subkeys(&self) -> Subkeys {
        Subkeys {
            name: hkdf(&self.0, b"type-object-sync/name/v1"),
            content: hkdf(&self.0, b"type-object-sync/content/v1"),
            manifest: hkdf(&self.0, b"type-object-sync/manifest/v1"),
        }
    }
}

#[derive(ZeroizeOnDrop)]
pub struct Subkeys {
    /// HMAC key turning a content hash into an object key.
    pub name: [u8; KEY_SIZE],
    /// Encrypts blob payloads.
    pub content: [u8; KEY_SIZE],
    /// Encrypts manifests.
    pub manifest: [u8; KEY_SIZE],
}

// ── HKDF-SHA256 (RFC 5869) ─────────────────────────────────────────────────────

fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    // Qualified: `chacha20poly1305`'s KeyInit is also in scope and offers its
    // own `new_from_slice`, which would reject a non-32-byte key.
    let mut mac =
        <HmacSha256 as Mac>::new_from_slice(key).expect("HMAC accepts keys of any length");
    mac.update(data);
    mac.finalize().into_bytes().into()
}

/// Extract-then-expand with an empty salt, producing exactly one block.
///
/// Hand-rolled rather than adding the `hkdf` crate, whose current release
/// tracks the `hmac`/`sha2` 0.11 pre-releases while this crate is on 0.10.
/// Checked against the RFC 5869 vectors below.
fn hkdf(ikm: &[u8], info: &[u8]) -> [u8; KEY_SIZE] {
    let prk = hkdf_extract(&[], ikm);
    let mut okm = [0u8; KEY_SIZE];
    hkdf_expand(&prk, info, &mut okm);
    okm
}

fn hkdf_extract(salt: &[u8], ikm: &[u8]) -> [u8; 32] {
    hmac_sha256(salt, ikm)
}

fn hkdf_expand(prk: &[u8], info: &[u8], out: &mut [u8]) {
    let mut previous: Vec<u8> = Vec::new();
    let mut counter: u8 = 1;
    let mut written = 0;
    while written < out.len() {
        let mut input = previous.clone();
        input.extend_from_slice(info);
        input.push(counter);
        let block = hmac_sha256(prk, &input);
        let take = (out.len() - written).min(block.len());
        out[written..written + take].copy_from_slice(&block[..take]);
        written += take;
        previous = block.to_vec();
        counter += 1;
    }
}

// ── AEAD envelope ──────────────────────────────────────────────────────────────

/// `magic || nonce || ciphertext`, with `aad` bound in.
///
/// The object key is what callers pass as `aad`, which ties a blob to its
/// location: an attacker who can write to the bucket cannot move a valid blob
/// to a different key and have it accepted.
pub fn seal(key: &[u8; KEY_SIZE], aad: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let mut nonce = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: plaintext, aad })
        .map_err(|error| format!("Failed to encrypt: {error}"))?;

    let mut out = Vec::with_capacity(BLOB_MAGIC.len() + NONCE_SIZE + ciphertext.len());
    out.extend_from_slice(BLOB_MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn open(key: &[u8; KEY_SIZE], aad: &[u8], stored: &[u8]) -> Result<Vec<u8>, String> {
    if stored.len() < BLOB_MAGIC.len() + NONCE_SIZE || !stored.starts_with(BLOB_MAGIC) {
        return Err(
            "Stored object is not in the expected encrypted format. It may predate encryption \
             being enabled, or belong to a different vault."
                .to_string(),
        );
    }
    let body = &stored[BLOB_MAGIC.len()..];
    let (nonce, ciphertext) = body.split_at(NONCE_SIZE);
    XChaCha20Poly1305::new(Key::from_slice(key))
        .decrypt(XNonce::from_slice(nonce), Payload { msg: ciphertext, aad })
        // A tag mismatch is the only signal available, and it covers a wrong
        // key, a corrupted blob, and a relocated one alike.
        .map_err(|_| {
            "Failed to decrypt an object. Wrong secret phrase, or the object was tampered with."
                .to_string()
        })
}

/// Object key for a blob: `HMAC(k_name, content_hash)`, hex.
///
/// Deterministic, so two devices holding the same note compute the same key and
/// dedup still works — while the bucket learns nothing about the content, since
/// it cannot compute the HMAC without the key.
pub fn opaque_name(name_key: &[u8; KEY_SIZE], content_hash: &str) -> String {
    let digest = hmac_sha256(name_key, content_hash.as_bytes());
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest.iter() {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

// ── Vault file ─────────────────────────────────────────────────────────────────

/// `<prefix>/vault.json` — the passphrase-wrapped vault key and its KDF
/// parameters. Contains no secret: without the passphrase it is inert, and the
/// parameters are stored so they can be raised later without stranding anyone.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct VaultFile {
    #[serde(default = "default_vault_version")]
    pub version: u32,
    pub kdf: KdfParams,
    /// base64 of `magic || nonce || ciphertext` over the vault key.
    pub wrapped_key: String,
}

fn default_vault_version() -> u32 {
    1
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct KdfParams {
    #[serde(default = "default_algo")]
    pub algo: String,
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
    /// base64, 16 bytes.
    pub salt: String,
}

fn default_algo() -> String {
    "argon2id".to_string()
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            algo: default_algo(),
            m_cost: KDF_M_COST,
            t_cost: KDF_T_COST,
            p_cost: KDF_P_COST,
            salt: String::new(),
        }
    }
}

fn derive_kek(passphrase: &str, params: &KdfParams) -> Result<[u8; KEY_SIZE], String> {
    if params.algo != "argon2id" {
        return Err(format!(
            "Unsupported key-derivation algorithm '{}'. Update the app.",
            params.algo
        ));
    }
    let salt = BASE64
        .decode(params.salt.trim())
        .map_err(|error| format!("Invalid vault salt: {error}"))?;

    let argon = Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(params.m_cost, params.t_cost, params.p_cost, Some(KEY_SIZE))
            .map_err(|error| format!("Invalid key-derivation parameters: {error}"))?,
    );
    let mut kek = [0u8; KEY_SIZE];
    argon
        .hash_password_into(passphrase.as_bytes(), &salt, &mut kek)
        .map_err(|error| format!("Failed to derive key: {error}"))?;
    Ok(kek)
}

/// Wrap a vault key under a passphrase, ready to upload.
pub fn wrap_vault_key(passphrase: &str, vault_key: &VaultKey) -> Result<VaultFile, String> {
    let passphrase = passphrase.trim();
    if passphrase.is_empty() {
        return Err("A secret phrase is required.".to_string());
    }

    let mut salt = [0u8; SALT_SIZE];
    OsRng.fill_bytes(&mut salt);
    let params = KdfParams {
        salt: BASE64.encode(salt),
        ..KdfParams::default()
    };

    let mut kek = derive_kek(passphrase, &params)?;
    let wrapped = seal(&kek, b"type-object-sync/vault/v1", &vault_key.0);
    kek.zeroize();

    Ok(VaultFile {
        version: default_vault_version(),
        kdf: params,
        wrapped_key: BASE64.encode(wrapped?),
    })
}

/// Recover the vault key. A wrong phrase fails on the AEAD tag, so no separate
/// verification value is needed.
pub fn unwrap_vault_key(passphrase: &str, vault: &VaultFile) -> Result<VaultKey, String> {
    let passphrase = passphrase.trim();
    if passphrase.is_empty() {
        return Err("A secret phrase is required.".to_string());
    }
    let wrapped = BASE64
        .decode(vault.wrapped_key.trim())
        .map_err(|error| format!("Invalid wrapped key: {error}"))?;

    let mut kek = derive_kek(passphrase, &vault.kdf)?;
    let opened = open(&kek, b"type-object-sync/vault/v1", &wrapped);
    kek.zeroize();

    let mut bytes = opened.map_err(|_| "That secret phrase does not match this vault.".to_string())?;
    let key: [u8; KEY_SIZE] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| "Vault key is malformed.".to_string())?;
    bytes.zeroize();
    Ok(VaultKey(key))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 5869 test case 1, verifying extract and expand separately — a bug in
    /// either would silently produce different-but-consistent subkeys, which no
    /// round-trip test would catch.
    #[test]
    fn hkdf_matches_the_rfc_5869_vector() {
        let ikm = [0x0bu8; 22];
        let salt: Vec<u8> = (0u8..=0x0c).collect();
        let info: Vec<u8> = (0xf0u8..=0xf9).collect();

        let prk = hkdf_extract(&salt, &ikm);
        assert_eq!(
            hex(&prk),
            "077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5"
        );

        let mut okm = [0u8; 42];
        hkdf_expand(&prk, &info, &mut okm);
        assert_eq!(
            hex(&okm),
            "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf\
             34007208d5b887185865"
        );
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    #[test]
    fn subkeys_are_distinct_and_deterministic() {
        let key = VaultKey::generate();
        let first = key.subkeys();
        let second = key.subkeys();

        assert_eq!(first.name, second.name);
        assert_eq!(first.content, second.content);
        assert_ne!(first.name, first.content);
        assert_ne!(first.content, first.manifest);
        assert_ne!(first.name, first.manifest);

        // A different root gives entirely different subkeys.
        assert_ne!(VaultKey::generate().subkeys().content, first.content);
    }

    #[test]
    fn sealed_payloads_round_trip_and_hide_the_plaintext() {
        let key = VaultKey::generate().subkeys().content;
        let plaintext = b"# Buy milk\n\nand bread";

        let sealed = seal(&key, b"objects/abc", plaintext).unwrap();
        assert!(!sealed.windows(4).any(|window| window == b"milk"));
        assert_eq!(open(&key, b"objects/abc", &sealed).unwrap(), plaintext);
    }

    #[test]
    fn the_same_plaintext_seals_differently_each_time() {
        let key = VaultKey::generate().subkeys().content;
        let a = seal(&key, b"k", b"same").unwrap();
        let b = seal(&key, b"k", b"same").unwrap();
        assert_ne!(a, b, "a fresh nonce must be used per seal");
    }

    #[test]
    fn a_blob_moved_to_another_key_is_rejected() {
        let key = VaultKey::generate().subkeys().content;
        let sealed = seal(&key, b"objects/aaa", b"secret note").unwrap();
        // Same bytes, wrong location: the AAD binding catches it.
        assert!(open(&key, b"objects/bbb", &sealed).is_err());
    }

    #[test]
    fn tampering_and_wrong_keys_are_rejected() {
        let key = VaultKey::generate().subkeys().content;
        let other = VaultKey::generate().subkeys().content;
        let mut sealed = seal(&key, b"k", b"note").unwrap();

        assert!(open(&other, b"k", &sealed).is_err());

        let last = sealed.len() - 1;
        sealed[last] ^= 0x01;
        assert!(open(&key, b"k", &sealed).is_err());
    }

    #[test]
    fn payloads_that_are_not_ours_fail_with_a_useful_message() {
        let key = VaultKey::generate().subkeys().content;
        // Plaintext left over from before encryption was turned on.
        let error = open(&key, b"k", b"# a plain markdown note").unwrap_err();
        assert!(error.contains("expected encrypted format"), "{error}");
        assert!(open(&key, b"k", b"").is_err());
    }

    #[test]
    fn object_names_are_deterministic_and_reveal_nothing() {
        let key = VaultKey::generate();
        let name_key = key.subkeys().name;
        let hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

        let first = opaque_name(&name_key, hash);
        assert_eq!(first, opaque_name(&name_key, hash), "two devices must agree");
        assert_eq!(first.len(), 64);
        assert!(!first.contains(hash), "the content hash must not survive");
        assert_ne!(first, opaque_name(&name_key, "another-hash"));

        // Without the key the name cannot be reproduced.
        let stranger = VaultKey::generate().subkeys().name;
        assert_ne!(opaque_name(&stranger, hash), first);
    }

    /// Argon2id at 64 MiB is deliberately slow, so the wrapping tests use the
    /// cheapest parameters the library accepts — the code path is identical.
    fn cheap_wrap(passphrase: &str, key: &VaultKey) -> VaultFile {
        let mut salt = [0u8; SALT_SIZE];
        OsRng.fill_bytes(&mut salt);
        let params = KdfParams {
            m_cost: 8,
            t_cost: 1,
            p_cost: 1,
            salt: BASE64.encode(salt),
            ..KdfParams::default()
        };
        let mut kek = derive_kek(passphrase, &params).unwrap();
        let wrapped = seal(&kek, b"type-object-sync/vault/v1", &key.0).unwrap();
        kek.zeroize();
        VaultFile {
            version: 1,
            kdf: params,
            wrapped_key: BASE64.encode(wrapped),
        }
    }

    #[test]
    fn a_wrapped_vault_key_comes_back_with_the_right_phrase_only() {
        let key = VaultKey::generate();
        let vault = cheap_wrap("correct horse battery staple", &key);

        let recovered = unwrap_vault_key("correct horse battery staple", &vault).unwrap();
        assert_eq!(recovered.to_base64(), key.to_base64());

        let error = unwrap_vault_key("wrong phrase", &vault).unwrap_err();
        assert!(error.contains("does not match"), "{error}");
    }

    #[test]
    fn surrounding_whitespace_in_a_phrase_is_forgiven() {
        let key = VaultKey::generate();
        let vault = cheap_wrap("my phrase", &key);
        // Phones love to add a trailing space; failing on that would look like
        // a lost vault.
        assert!(unwrap_vault_key("  my phrase  ", &vault).is_ok());
    }

    #[test]
    fn an_empty_phrase_is_refused_on_both_sides() {
        let key = VaultKey::generate();
        assert!(wrap_vault_key("   ", &key).is_err());
        assert!(unwrap_vault_key("", &cheap_wrap("x", &key)).is_err());
    }

    #[test]
    fn the_vault_file_carries_no_usable_secret() {
        let key = VaultKey::generate();
        let vault = cheap_wrap("phrase", &key);
        let json = serde_json::to_string(&vault).unwrap();

        assert!(!json.contains(&key.to_base64()));
        assert!(json.contains("argon2id"));
        // And it round-trips through the bucket as JSON.
        let parsed: VaultFile = serde_json::from_str(&json).unwrap();
        assert_eq!(
            unwrap_vault_key("phrase", &parsed).unwrap().to_base64(),
            key.to_base64()
        );
    }

    #[test]
    fn the_default_parameters_are_the_ones_we_intend_to_ship() {
        let defaults = KdfParams::default();
        assert_eq!(defaults.algo, "argon2id");
        assert_eq!(defaults.m_cost, 65_536);
        assert_eq!(defaults.t_cost, 3);
    }

    #[test]
    fn an_unknown_kdf_is_refused_rather_than_guessed_at() {
        let vault = VaultFile {
            version: 1,
            kdf: KdfParams {
                algo: "scrypt".to_string(),
                salt: BASE64.encode([0u8; SALT_SIZE]),
                ..KdfParams::default()
            },
            wrapped_key: String::new(),
        };
        let error = unwrap_vault_key("phrase", &vault).unwrap_err();
        assert!(error.contains("Unsupported"), "{error}");
    }

    #[test]
    fn debug_output_never_contains_the_key() {
        let key = VaultKey::generate();
        let rendered = format!("{key:?}");
        assert_eq!(rendered, "VaultKey(<redacted>)");
        assert!(!rendered.contains(&key.to_base64()));
    }

    #[test]
    fn vault_keys_survive_the_base64_round_trip_used_to_persist_them() {
        let key = VaultKey::generate();
        assert_eq!(
            VaultKey::from_base64(&key.to_base64()).unwrap().to_base64(),
            key.to_base64()
        );
        assert!(VaultKey::from_base64("not base64!").is_err());
        assert!(VaultKey::from_base64(&BASE64.encode([0u8; 8])).is_err());
    }
}
