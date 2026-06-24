# Encryption · lock screen · PIN · panic mode — implementation guide (Stage 5, **not implemented**)

A precise guide for adding at-rest encryption to the iOS app **byte-compatibly**
with the desktop, plus the lock screen, PIN/biometric unlock, and the panic wipe.
This is a guide, **not code** — but it is concrete enough to implement directly.

Source of truth on the desktop side: `src-tauri/src/adapters/security.rs`
(constants, crypto, panic flow). Everything below cites it so the two stay in
lockstep.

---

## 0. The one hard rule: the crypto must match exactly

Encrypted note bodies sync through the **same git repo** (or iCloud). If iOS and
desktop don't produce/consume the **identical envelope**, one side writes notes
the other can't read. So the contract below is not negotiable.

### 0.1 What is encrypted

- **Only the note body.** Front-matter (`id`, `created_ms`, `recording_audio_path`,
  `transcription_status`, …) stays **plaintext** — it must, because the tree,
  previews, ordering and recording/OCR scanners read it without a key.
- **Recordings and attachments stay unencrypted** (AGENTS.md gotcha). Audio in
  `Recordings/` is plaintext. Only `.md` bodies are protected. (Scope to revisit
  later, but match desktop today.)
- Filenames stay plaintext.

### 0.2 The body envelope (`security.rs` `encrypt_note_body_with_key`)

```
encrypted_body = "NV_ENC_V1:" + base64_standard( nonce24 ‖ ciphertext )
```

- Marker prefix: **`NV_ENC_V1:`** (`SECURITY_NOTE_BODY_PREFIX`). A body is
  "encrypted" iff `body.trimStart().hasPrefix("NV_ENC_V1:")`
  (`is_encrypted_note_body`).
- Base64 is **standard** (not URL-safe), with padding (`base64` crate `STANDARD`).
- Payload = **24-byte nonce** immediately followed by the AEAD ciphertext (which
  already includes the **16-byte Poly1305 tag** at the end).
- Cipher: **XChaCha20-Poly1305**, 32-byte key, 24-byte random nonce per write,
  **no additional authenticated data**.
- Idempotent: encrypting an already-`NV_ENC_V1:` body is a no-op; same for
  decrypting a non-encrypted body (round-trips plaintext unchanged).

### 0.3 Key derivation (`derive_security_key`)

```
key32 = Argon2id( password, key_salt16,  m = 19456 KiB, t = 2, p = 1, v = 0x13,  outLen = 32 )
```

- This is the **raw** Argon2id output, **not** a PHC string. `Argon2::default()`
  in the `argon2` crate = Argon2id, version 0x13, params **m_cost = 19456 (KiB),
  t_cost = 2, p_cost = 1**. Match these exactly.
- `key_salt` = **16 random bytes** (`SECURITY_SALT_SIZE`), stored **base64** in
  the config as `key_salt`.
- The derived key lives **only in memory** (zeroized on lock); never persisted in
  plaintext.

### 0.4 Password hashes (`security_password_hash` / `_matches`)

- `unlock_password_hash` and `panic_password_hash` are **PHC strings**
  (`$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`) each with their **own** random
  salt (independent of `key_salt`). They are **auth checks only** — they do **not**
  derive the data key.
- Verification = standard Argon2id PHC verify.

> **Why two salts?** The data key comes from `Argon2id(password, key_salt)`. The
> stored hashes only answer "is this the unlock password / the panic password?".
> The panic password must be recognized **without** deriving a working key
> (it never decrypts anything — it wipes), which is exactly why it needs its own
> verifiable hash.

### 0.5 Config file (`SecurityConfigFile`)

`.notes-security.json`, stored in **app data — NOT in any notes root** (so it
never syncs). Fields (serde snake_case, all defaultable):

```json
{
  "encryption_enabled": false,
  "unlock_password_hash": "",
  "panic_password_hash": "",
  "key_salt": "",
  "auto_lock_on_background": true
}
```

iOS stores its own copy in Application Support (next to the workspaces config).

---

## 1. The library choice (this is what makes it interoperable)

**CryptoKit cannot do this.** `CryptoKit.ChaChaPoly` is the **IETF 12-byte-nonce**
variant — not XChaCha20 (24-byte nonce). Using it would be incompatible.

Use **libsodium** via **swift-sodium** (`jedisct1/swift-sodium`, a single SPM
package that vendors libsodium). It has the exact primitives, byte-for-byte
matching RustCrypto:

| Need | swift-sodium call | Matches Rust |
|------|-------------------|--------------|
| XChaCha20-Poly1305 encrypt | `sodium.aead.xchacha20poly1305ietf.encrypt(message:secretKey:)` → `nonce ‖ ct` | RustCrypto `XChaCha20Poly1305` (same construction; combined output is nonce-prefixed) |
| …decrypt | `sodium.aead.xchacha20poly1305ietf.decrypt(nonceAndAuthenticatedCipherText:secretKey:)` | same |
| Derive key | `sodium.pwHash.hash(outputLength: 32, passwd: pw, salt: salt16, opsLimit: 2, memLimit: 19456*1024, alg: .Argon2ID13)` | `Argon2id(m=19456KiB, t=2, p=1)` |
| Hash password (PHC) | `sodium.pwHash.str(passwd:opsLimit:memLimit:)` (Argon2id PHC) | `Argon2::hash_password` PHC |
| Verify password | `sodium.pwHash.strVerify(hash:passwd:)` | `Argon2::verify_password` |

Two subtleties to verify on device:

1. libsodium's combined AEAD output is **`nonce ‖ ciphertext`**, exactly the Rust
   envelope order — so `"NV_ENC_V1:" + base64(combined)` is byte-identical. (If you
   instead use the detached API, you must prepend the nonce yourself.)
2. libsodium `memLimit` is **bytes**: `19456 * 1024`. `opsLimit = 2`. libsodium
   Argon2id requires `p = 1` (it has no parallel knob) — which is exactly the
   desktop's `p_cost = 1`. Confirm a vector: derive a key from a known
   password+salt on both desktop and iOS and assert equality before trusting it.

> If swift-sodium is undesirable, the fallback is vendoring libsodium directly, or
> a vetted XChaCha20-Poly1305 + Argon2id pair — but **do not** hand-roll either.

---

## 2. iOS architecture (mirrors the desktop security domain)

```
Support/
  SecurityCrypto.swift     pure: envelope encode/decode, deriveKey, pwHash/verify
                           (the byte-compatible core — unit-test against vectors)
Storage/
  SecurityStore.swift      .notes-security.json load/save in App Support
Security/
  SecurityManager.swift    @MainActor @Observable: state, key (zeroized on lock),
                           enable/unlock/lock/panic, auto-lock on background
Features/Security/
  LockScreenView.swift     PIN/password entry + Face ID; the gate UI
App/
  AppState.swift           owns SecurityManager; gates content behind `locked`
  RootView.swift           overlays LockScreenView when encryption_enabled && locked
```

`SecurityManager` is the analogue of `SECURITY_RUNTIME` (the in-memory key + lock
flag). The in-memory key should be a `var key: [UInt8]?` wiped on lock
(overwrite with zeros before setting nil — Swift has no `Zeroize`, so do it
manually; consider a small locked buffer).

### 2.1 Wiring encryption into `NotesStore`

The desktop calls `encrypt_note_body_for_write` in the write path and
`decrypt_note_body_for_read` in the read path. Mirror that with a **body-crypto
seam** so `NotesStore` stays unaware of keys:

```
protocol NoteBodyCrypto {                 // design sketch
    func encryptForWrite(_ body: String) throws -> String   // no-op if disabled
    func decryptForRead(_ body: String) throws -> String    // no-op if plaintext
}
```

- `NotesStore` gains an optional `bodyCrypto: NoteBodyCrypto?`.
- `writeDocument` runs `body = bodyCrypto?.encryptForWrite(body) ?? body` **after**
  front-matter is assembled but **before** writing.
- `readDocument` runs `doc.body = bodyCrypto?.decryptForRead(doc.body) ?? doc.body`
  **after** `NoteDocument.parse` (front-matter parsed from plaintext header; only
  the body is ciphertext).
- `SecurityManager` is the concrete `NoteBodyCrypto`: disabled → identity;
  enabled+unlocked → real; enabled+locked → **throw** the lock error (matches
  `SECURITY_LOCKED_ERROR`).

Important ordering: encryption wraps the **logical body** (what the editor shows),
*after* the header-separator handling in `NoteDocument`. So a written file is
`---\n<plaintext front-matter>\n---\n\nNV_ENC_V1:…`. Round-trip: parse strips the
header, decrypt the body. This is exactly the desktop's pipeline.

### 2.2 The lock gate (backend-enforced parity)

The desktop rejects most commands while locked (`ensure_security_unlocked_for_app`).
On iOS there's no IPC boundary, so enforce it two ways:

1. **UI gate**: `RootView` shows only `LockScreenView` when
   `encryption_enabled && locked` (nothing else mounts) — analogous to the
   frontend `SecurityGate`.
2. **Data gate**: `NoteBodyCrypto.decryptForRead/encryptForWrite` throw while
   locked, so even a stray code path can't read/write plaintext without a key.

---

## 3. Enable flow (`enable_security_impl`)

User sets an **unlock** password/PIN and a **distinct panic** password/PIN.

1. Validate: both non-empty, and **must differ** (desktop rejects equal).
2. `key_salt = 16 random bytes`; `key = deriveKey(unlock, key_salt)`.
3. `unlock_password_hash = pwHashPHC(unlock)`, `panic_password_hash =
   pwHashPHC(panic)`.
4. **Encrypt every existing note body in place** across all workspaces' roots
   (`migrate_root_note_bodies_to_encrypted`): for each `.md`, parse → encrypt body
   → re-render → write. Idempotent on already-encrypted bodies.
5. Persist `.notes-security.json` with `encryption_enabled = true`.
6. Set runtime: `locked = false`, hold `key` in memory.

On iOS, step 4 must run **off the main actor** (it rewrites the whole library) with
progress UI, and must be **interruption-safe** — write each note atomically so a
crash leaves a mix of encrypted/plaintext notes that the idempotent marker check
heals on the next pass.

> **Note-previews caution:** the preview cache must be **purged and disabled**
> while encryption is on (the desktop does this — AGENTS.md: persistence is
> disabled under encryption, enabling purges snapshots). Otherwise plaintext
> previews leak to disk. The iOS preview cache (when added) must follow the same
> rule.

---

## 4. Unlock flow (`unlock_security_impl`) — incl. panic

On the lock screen the user enters a PIN/password. Order matters:

1. If `encryption_enabled == false` → trivially unlocked.
2. **Check the panic hash first.** If `strVerify(panic_hash, entered)` →
   **panic wipe** (see §6). Return `panic_triggered = true`.
3. Else if **not** `strVerify(unlock_hash, entered)` → "Invalid password", stay
   locked. (No key derived.)
4. Else derive `key = deriveKey(entered, key_salt)`, set `locked = false`, hold
   the key.

The panic-before-unlock order is essential: the panic password must wipe **even
though** it's a valid-looking entry, and must never derive a usable key.

---

## 5. Lock flow, auto-lock, PIN & biometrics

### 5.1 Lock (`lock_security_impl`)

Zero and drop the in-memory key; set `locked = true`. The config on disk is
unchanged (still `encryption_enabled = true`). Cheap and synchronous.

### 5.2 Auto-lock on background

`auto_lock_on_background` (default **true**). Observe `scenePhase`/
`UIApplication.didEnterBackgroundNotification`; when leaving `.active`, if the
pref is on, **flush the editor first** (debounced save — a locked write would
throw), then `lock()`. This mirrors the desktop's auto-lock and the existing
`commitDraft()`-on-background in `RootView`.

### 5.3 PIN vs password

The desktop treats the secret as a free-form string. On iOS, a **6-digit PIN** is
just that string of digits — no protocol change, only a numeric keypad in
`LockScreenView`. (Allow an "use a passphrase instead" mode for users who want
more entropy; a short PIN's security rests on Argon2id cost + the panic wipe, not
length.)

### 5.4 Face ID / Touch ID (convenience, optional)

Biometrics must still recover the **data key** (Argon2id is one-way; the key can't
be reconstructed from biometrics alone). Pattern:

- On enable/first successful unlock, store the **32-byte data key** in the
  **Keychain** under an item protected by
  `SecAccessControl(.biometryCurrentSet, .privateKeyUsage/. userPresence)` and
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.
- Unlock-with-FaceID = `LocalAuthentication` evaluates → Keychain returns the key
  → set `locked = false`. No Argon2id needed on the happy path.
- **PIN entry remains the fallback** (and the only path right after a reboot,
  before first biometric unlock, per `…ThisDeviceOnly` + biometry rules).
- `.biometryCurrentSet` invalidates the stored key if the enrolled face/finger
  set changes (anti-coercion). The panic PIN still works regardless.

This is iOS-only sugar; it does **not** touch the on-disk format or the desktop.

---

## 6. Panic mode (`panic_reset_local_data`)

Entering the **panic** PIN on the lock screen performs a **local wipe** and a
benign reseed, so a coerced unlock reveals an innocuous, empty-looking app.

Mirror the desktop steps exactly:

1. Delete every workspace's notes root (`remove_dir_all` each `notes_root`).
2. Delete the workspaces config + `.notes-security.json` (+ any native-recordings
   dir).
3. Recreate a **default** workspace, `ensureSystemFolders()`.
4. **Seed 3 dummy notes** in `Feed` (the desktop writes `dummy-1-welcome.md`,
   `dummy-2-local-sync.md`, `dummy-3-security.md` with `created_ms`/`updated_ms`
   = now+index and plain bodies). Reproduce these so a synced desktop sees the
   same reset state.
5. Reset runtime: `encryption_enabled = false`, `locked = false`, key zeroized.
6. **Frontend/app**: clear any local caches (preview snapshots, draft text) and
   re-bootstrap — the iOS analogue of the web app clearing `localStorage` and
   reloading.

### 6.1 The blunt truth about panic + sync

Panic wipes **local** data only. If the profile syncs (git or iCloud), **the
remote still has everything**, and the next sync could pull it back. The desktop
has this same limitation. Options to document (and decide later):

- **Minimum (matches desktop):** local wipe only; warn the user that remote
  copies persist.
- **Stronger (iOS choice to make):** on panic, also drop the git credential from
  the Keychain and clear the remote URL, so the wiped device can't re-pull. (It
  does *not* delete the remote — that would need a force-push of an orphan
  history, which is destructive and out of scope.)
- For iCloud, "stop syncing" means evicting the local ubiquitous copy and
  detaching the container — coordinate with `ICLOUD_SYNC.md`.

Pick the minimum for parity first; treat credential-drop as an iOS hardening
follow-up.

---

## 7. Cross-device encryption — the salt problem (read this)

`.notes-security.json` (with `key_salt`) lives in **app data and does not sync**.
But the data key is `Argon2id(password, key_salt)`. So **two devices with
different `key_salt` derive different keys from the same password** and cannot
read each other's encrypted notes — even though the ciphertext syncs fine.

This already affects desktop↔desktop. For iOS to read desktop-encrypted notes (or
vice-versa) the **`key_salt` must be shared**. Three options:

1. **Manual:** user copies the base64 `key_salt` from desktop into iOS during
   enable ("I already have encryption on another device"). Zero new sync surface;
   ugly UX.
2. **Synced salt file (recommended, coordinated change):** store *only* the
   `key_salt` (never a password, never the key) in a file **inside the notes
   root** — e.g. `.notes-encryption-salt.json` — so it travels with the repo. Both
   apps read the salt from there and keep hashes/prefs local. The salt is **not
   secret** (Argon2id is designed to be public-salt); only the password is. This
   is the clean fix and needs a matching desktop change.
3. **Password-only KDF:** drop the salt (derive from password alone). **Rejected**
   — removes salting, enabling rainbow-table/precompute attacks. Don't.

**Recommendation:** implement option 2 as a small, coordinated desktop+iOS change
when encryption ships, and until then make the iOS enable flow explicit that
encryption is single-device unless the salt is shared.

---

## 8. Test vectors to lock down before trusting any of this

Build these as unit tests (`SecurityCrypto` is pure, so they run on the Linux CI
host too if libsodium is present, and on device):

1. **KDF vector:** `deriveKey("hunter2", saltFromBase64, m=19456,t=2,p=1)` equals
   the desktop's derived key for the same inputs (compare hex).
2. **Envelope round-trip:** desktop-encrypted body (captured string starting
   `NV_ENC_V1:`) decrypts on iOS to the original plaintext, and vice-versa.
3. **Marker idempotency:** encrypting an `NV_ENC_V1:` body is a no-op; decrypting
   a plaintext body returns it unchanged.
4. **PHC verify:** a desktop `panic_password_hash` verifies on iOS and a wrong
   password fails.
5. **Front-matter untouched:** after encrypt-on-write, the header bytes are
   identical to the desktop's for the same note (only the body differs).

If vectors 1–2 pass, the two apps share encrypted notes. Everything else is UI.

---

All of the above is **design only** for this stage — no Swift was added.
