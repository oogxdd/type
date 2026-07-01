use serde::Serialize;

// ── Types ──────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct SecurityState {
    pub encryption_enabled: bool,
    pub locked: bool,
    pub auto_lock_on_background: bool,
}

#[derive(Serialize)]
pub struct UnlockResult {
    pub unlocked: bool,
    pub panic_triggered: bool,
    pub reset_required: bool,
    pub message: Option<String>,
}

// ── Trait ──────────────────────────────────────────────────────────────────────

pub trait SecurityService {
    fn get_state(&self) -> Result<SecurityState, String>;
    fn enable(&self, unlock_password: &str, panic_password: &str) -> Result<SecurityState, String>;
    fn lock(&self) -> Result<SecurityState, String>;
    fn unlock(&self, password: &str) -> Result<UnlockResult, String>;
    fn set_preferences(&self, auto_lock_on_background: bool) -> Result<SecurityState, String>;
    fn is_unlocked(&self) -> Result<(), String>;
}

/// Internal application-facing gateway implemented by the Tauri security
/// adapter. Associated DTOs preserve the existing IPC contract during migration.
pub trait SecurityGateway {
    type State;
    type EnableArgs;
    type UnlockArgs;
    type UnlockResult;
    type PreferencesArgs;

    fn state(&self) -> Result<Self::State, String>;
    fn enable(&self, args: Self::EnableArgs) -> Result<Self::State, String>;
    fn lock(&self) -> Result<Self::State, String>;
    fn unlock(&self, args: Self::UnlockArgs) -> Result<Self::UnlockResult, String>;
    fn set_preferences(&self, args: Self::PreferencesArgs) -> Result<Self::State, String>;
}

// ─── Implementation Notes ─────────────────────────────────────────────────────
//
// SecurityService manages optional encryption and app locking.
// When enabled, all note bodies are encrypted at rest and the app requires
// a password to unlock after being backgrounded or restarted.
//
// get_state()
//   in:  nothing
//   out: SecurityState — whether encryption is enabled, whether the app is locked,
//        and the auto-lock preference
//   - Loads config from disk on first call, caches in memory afterward
//
// enable(unlock_password, panic_password)
//   in:  unlock_password — the password used to unlock the app normally
//        panic_password — a different password that triggers a full data wipe
//   out: SecurityState — updated state (encryption_enabled=true, locked=false)
//   - Both passwords are required and must be different
//   - Hashes both passwords with Argon2
//   - Generates a random salt for key derivation
//   - Derives a 256-bit encryption key from the unlock password
//   - Encrypts ALL existing note bodies across all profiles
//   - Persists config to disk (.notes-security.json)
//   - Encryption scheme: XChaCha20-Poly1305 with 192-bit random nonce
//   - Encrypted body format: "NV_ENC_V1:{base64(nonce + ciphertext)}"
//
// lock()
//   in:  nothing
//   out: SecurityState — updated state (locked=true)
//   - Wipes the encryption key from memory (zeroized)
//   - All note operations will fail with "Notes are locked" until unlocked
//   - No-op if encryption is not enabled
//
// unlock(password)
//   in:  password — the user's password attempt
//   out: UnlockResult — whether it worked, and whether panic was triggered
//   - If the password matches the unlock hash: derives key, loads it into memory, unlocks
//   - If the password matches the panic hash: WIPES ALL DATA and resets to defaults
//     (deletes all profiles, notes, security config; seeds dummy notes)
//   - If neither matches: returns unlocked=false with "Invalid password" message
//   - No-op if encryption is not enabled (auto-unlocks)
//
// set_preferences(auto_lock_on_background)
//   in:  auto_lock_on_background — whether to auto-lock when the app goes to background
//   out: SecurityState — updated state
//   - Persists the preference to disk
//
// is_unlocked()
//   in:  nothing
//   out: nothing (returns Ok if unlocked, Err if locked)
//   - Gate function — call before any note operation
//   - Returns Err("Notes are locked. Unlock the app first.") if locked
//
// Key assumptions for any implementation:
//   - Security config is persisted as JSON (.notes-security.json in app data)
//   - Password hashes use Argon2 with random salt
//   - Key derivation uses Argon2 with a stored salt
//   - Encryption is XChaCha20-Poly1305 (256-bit key, 192-bit nonce)
//   - Encrypted bodies are prefixed with "NV_ENC_V1:" for detection
//   - The encryption key is held in memory only while unlocked, then zeroized
//   - The panic password is a dead-man's switch that destroys all data
