// The seam between the app and the Rust core.
//
// `RawCore` mirrors the UniFFI exports of crates/type-ffi one-to-one:
// structured inputs/outputs are JSON strings (the same serde shapes the
// desktop Tauri commands speak), and function names are the camelCase form
// uniffi-bindgen-react-native generates from the Rust snake_case exports.
//
// The app never imports the generated turbo module directly. Instead the
// entry point calls `setRawCore(...)` once with either the generated module
// (wired on a Mac — see the package README) or the in-memory mock
// (`mock-core.ts`) when the native library isn't built, e.g. in Expo Go or
// on CI. Everything else goes through `getRawCore()`.

/** Host-implemented transcription backend (FFI foreign trait). */
export interface RawTranscriptionProvider {
  /** Stable identifier used in error messages, e.g. "apple-speech". */
  id(): string;
  /** Transcribe the audio file at `audioPath` (absolute) into plain text. */
  transcribe(audioPath: string): string | Promise<string>;
}

export interface RawCore {
  /** Must be called before anything else. Idempotent across JS reloads. */
  initCore(appDataDir: string, documentsDir: string | undefined): void | Promise<void>;

  // ── Notes ──
  getTree(): Promise<string>;
  readNote(path: string): Promise<string>;
  createNote(argsJson: string): Promise<string>;
  writeNote(path: string, content: string): Promise<void>;
  setNoteTimestamp(argsJson: string): Promise<void>;
  updateNoteMarkers(argsJson: string): Promise<void>;
  getNoteMeta(path: string): Promise<string>;
  listNotePreviews(paths: string[]): Promise<string>;
  moveItems(items: string[], destination: string): Promise<void>;
  deleteItems(items: string[]): Promise<void>;
  renameItem(path: string, newName: string): Promise<string>;
  setOrder(argsJson: string): Promise<void>;

  // ── Working folders ("profiles") + device app config ──
  getProfiles(): Promise<string>;
  createProfile(argsJson: string): Promise<string>;
  setActiveProfile(profileId: string): Promise<string>;
  setProfileNotesRoot(profileId: string, notesRoot: string): Promise<string>;
  updateProfile(argsJson: string): Promise<string>;
  deleteProfile(profileId: string): Promise<string>;
  updateProfileSettings(argsJson: string): Promise<string>;
  updateAppConfig(argsJson: string): Promise<string>;
  createProfilesBackupZip(): Promise<string>;
  exportProfilesToDocuments(): Promise<string>;

  // ── Git sync ──
  generateSshKey(): Promise<string>;
  getSshPublicKey(): Promise<string | undefined>;
  deleteSshKey(): Promise<void>;
  getGitStatus(): Promise<string>;
  getGitHistory(argsJson: string | undefined): Promise<string>;
  connectGitRepo(argsJson: string): Promise<string>;
  gitPull(argsJson: string): Promise<string>;
  gitPush(argsJson: string): Promise<string>;
  /** Snapshot of the in-flight pull/push transfer progress (sync read).
   * Optional: absent in native modules generated before it existed —
   * `core-api` feature-detects and reports idle instead. */
  getGitSyncProgress?(): string;

  // ── Object-storage sync ──
  // All optional for the same reason as `getGitSyncProgress`: the native
  // module is generated on a Mac, so a build made before these existed must
  // keep working. `core-api` feature-detects each one.
  getObjectSyncStatus?(): Promise<string>;
  getObjectSyncSettings?(): Promise<string>;
  setObjectSyncSettings?(settingsJson: string): Promise<string>;
  testObjectSyncConnection?(settingsJson: string): Promise<void>;
  objectSyncNow?(): Promise<string>;
  requestObjectSync?(reason: string | undefined): Promise<void>;
  enableObjectSyncEncryption?(passphrase: string): Promise<string>;
  unlockObjectSyncEncryption?(passphrase: string): Promise<string>;
  applyObjectSyncPairingLink?(link: string): Promise<string>;

  // ── Recordings ──
  saveAudioRecording(argsJson: string): Promise<string>;
  queueRecordingTranscriptions(argsJson: string): Promise<string>;
  queueProviderTranscriptions(provider: RawTranscriptionProvider): Promise<string>;
  listRecordings(): Promise<string>;
  readRecordingAudio(path: string): Promise<string>;

  // ── Photo attachments ──
  saveHandwritingAttachment(argsJson: string): Promise<string>;

  // ── Security ──
  getSecurityState(): Promise<string>;
  enableSecurity(argsJson: string): Promise<string>;
  lockSecurity(): Promise<string>;
  unlockSecurity(argsJson: string): Promise<string>;
  setSecurityPreferences(argsJson: string): Promise<string>;
}

let rawCore: RawCore | null = null;

export const setRawCore = (core: RawCore) => {
  rawCore = core;
};

export const isRawCoreSet = () => rawCore !== null;

export const getRawCore = (): RawCore => {
  if (!rawCore) {
    throw new Error(
      "Rust core is not wired. Call setRawCore(...) at app startup — with the " +
        "generated native module (see packages/mobile-core/README.md) or with " +
        "createMockCore() for demo mode."
    );
  }
  return rawCore;
};
