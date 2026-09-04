// Typed facade over RawCore. This is what the app imports: every function
// serializes its args to the serde JSON shape the Rust core expects and
// parses results back into the shared wire types (@typenotes/shared/types),
// so screens and stores never touch JSON strings.

import type {
  AppConfig,
  ConnectGitArgs,
  CreateNoteArgs,
  CreateNoteResult,
  CreateProfileArgs,
  EnableSecurityArgs,
  FolderNode,
  GitCommitArgs,
  GitCommitHistoryEntry,
  GitHistoryArgs,
  GitPushArgs,
  GitSyncArgs,
  GitSyncStatus,
  GitTransferProgress,
  HandwritingAttachmentWriteResult,
  IrohAudioArchiveResult,
  IrohClientStatus,
  MobileAudioPruneResult,
  NoteMeta,
  NotePreviewEntry,
  ProfilesBackupArchive,
  ProfilesDocumentsExport,
  ProfilesSnapshot,
  QueueRecordingsArgs,
  RecordingAudioPayload,
  RecordingsListResult,
  RecordingTranscriptionQueueResult,
  RecordingWriteResult,
  SaveRecordingArgs,
  SaveHandwritingAttachmentArgs,
  StartIrohClientArgs,
  SecurityState,
  SecurityUnlockResult,
  SetNoteMarkersArgs,
  SetNoteTimestampArgs,
  SetOrderArgs,
  SetSecurityPreferencesArgs,
  UnlockSecurityArgs,
  UpdateProfileArgs,
  UpdateProfileSettingsArgs,
} from "@typenotes/shared/types";

import { getRawCore, type RawTranscriptionProvider } from "./raw-core";

const parse = <T>(json: string): T => JSON.parse(json) as T;

// ── Init ───────────────────────────────────────────────────────────────────────

export const initCore = async (
  appDataDir: string,
  documentsDir?: string
): Promise<void> => {
  await getRawCore().initCore(appDataDir, documentsDir);
};

// ── Notes ──────────────────────────────────────────────────────────────────────

export const getTree = async (): Promise<FolderNode> =>
  parse(await getRawCore().getTree());

export const readNote = (path: string): Promise<string> =>
  getRawCore().readNote(path);

export const createNote = async (
  args: CreateNoteArgs = {}
): Promise<CreateNoteResult> =>
  parse(await getRawCore().createNote(JSON.stringify(args)));

export const writeNote = (path: string, content: string): Promise<void> =>
  getRawCore().writeNote(path, content);

export const setNoteTimestamp = (args: SetNoteTimestampArgs): Promise<void> =>
  getRawCore().setNoteTimestamp(JSON.stringify(args));

export const updateNoteMarkers = (args: SetNoteMarkersArgs): Promise<void> =>
  getRawCore().updateNoteMarkers(JSON.stringify(args));

export const getNoteMeta = async (path: string): Promise<NoteMeta> =>
  parse(await getRawCore().getNoteMeta(path));

export const listNotePreviews = async (
  paths: string[]
): Promise<NotePreviewEntry[]> =>
  parse(await getRawCore().listNotePreviews(paths));

export const moveItems = (items: string[], destination: string): Promise<void> =>
  getRawCore().moveItems(items, destination);

export const deleteItems = (items: string[]): Promise<void> =>
  getRawCore().deleteItems(items);

/** Returns the item's new relative path. */
export const renameItem = (path: string, newName: string): Promise<string> =>
  getRawCore().renameItem(path, newName);

export const setOrder = (args: SetOrderArgs): Promise<void> =>
  getRawCore().setOrder(JSON.stringify(args));

// ── Working folders ("profiles") + device app config ──────────────────────────

export const getProfiles = async (): Promise<ProfilesSnapshot> =>
  parse(await getRawCore().getProfiles());

export const createProfile = async (
  args: CreateProfileArgs
): Promise<ProfilesSnapshot> =>
  parse(await getRawCore().createProfile(JSON.stringify(args)));

export const setActiveProfile = async (
  profileId: string
): Promise<ProfilesSnapshot> =>
  parse(await getRawCore().setActiveProfile(profileId));

/**
 * Point a working folder at a different directory (absolute path, e.g. a
 * user-visible location in Files). Existing content is moved over.
 */
export const setProfileNotesRoot = async (
  profileId: string,
  notesRoot: string
): Promise<ProfilesSnapshot> =>
  parse(await getRawCore().setProfileNotesRoot(profileId, notesRoot));

export const updateProfile = async (
  args: UpdateProfileArgs
): Promise<ProfilesSnapshot> =>
  parse(await getRawCore().updateProfile(JSON.stringify(args)));

export const deleteProfile = async (
  profileId: string
): Promise<ProfilesSnapshot> =>
  parse(await getRawCore().deleteProfile(profileId));

/** Persists to `.type/settings.json` inside the folder's notes root. */
export const updateProfileSettings = async (
  args: UpdateProfileSettingsArgs
): Promise<ProfilesSnapshot> =>
  parse(await getRawCore().updateProfileSettings(JSON.stringify(args)));

/** Device-local config (API keys etc.) — stored in app data, never synced. */
export const updateAppConfig = async (
  config: AppConfig
): Promise<ProfilesSnapshot> =>
  parse(await getRawCore().updateAppConfig(JSON.stringify({ config })));

export const createProfilesBackupZip = async (): Promise<ProfilesBackupArchive> =>
  parse(await getRawCore().createProfilesBackupZip());

export const exportProfilesToDocuments =
  async (): Promise<ProfilesDocumentsExport> =>
    parse(await getRawCore().exportProfilesToDocuments());

// ── Git sync ───────────────────────────────────────────────────────────────────

/** Generate the app-managed Ed25519 keypair; returns the public key. */
export const generateSshKey = (): Promise<string> => getRawCore().generateSshKey();

export const getSshPublicKey = async (): Promise<string | null> =>
  (await getRawCore().getSshPublicKey()) ?? null;

export const deleteSshKey = (): Promise<void> => getRawCore().deleteSshKey();

export const getGitStatus = async (): Promise<GitSyncStatus> =>
  parse(await getRawCore().getGitStatus());

export const getGitHistory = async (
  args?: GitHistoryArgs
): Promise<GitCommitHistoryEntry[]> =>
  parse(
    await getRawCore().getGitHistory(args ? JSON.stringify(args) : undefined)
  );

export const connectGitRepo = async (
  args: ConnectGitArgs
): Promise<GitSyncStatus> =>
  parse(await getRawCore().connectGitRepo(JSON.stringify(args)));

export const gitPull = async (args: GitSyncArgs = {}): Promise<GitSyncStatus> =>
  parse(await getRawCore().gitPull(JSON.stringify(args)));

export const gitCommit = async (args: GitCommitArgs = {}): Promise<GitSyncStatus> =>
  parse(await getRawCore().gitCommit(JSON.stringify(args)));

export const gitPush = async (args: GitPushArgs = {}): Promise<GitSyncStatus> =>
  parse(await getRawCore().gitPush(JSON.stringify(args)));

/** Start/reuse the mobile loopback proxy for an SSH-over-Iroh remote. */
export const startIrohSyncClient = async (
  args: StartIrohClientArgs
): Promise<IrohClientStatus> =>
  parse(await getRawCore().startIrohSyncClient(JSON.stringify(args)));

/**
 * How the direct connection to the computer is doing right now, or null when
 * no proxy has been started this session.
 *
 * Feature-detected: a native module generated before this export existed simply
 * reports nothing, which the Sync screen renders as "not connected yet" rather
 * than as an error.
 */
export const getIrohClientStatus = async (
  remoteUrl: string
): Promise<IrohClientStatus | null> => {
  const core = getRawCore();
  if (!core.irohClientStatus) {
    return null;
  }
  return parse(await core.irohClientStatus(remoteUrl));
};

/** Copy local recording bytes to the paired desktop outside Git. */
export const archiveMobileAudioWithIroh = async (): Promise<IrohAudioArchiveResult> =>
  parse(await getRawCore().archiveMobileAudioWithIroh());

/** Switch recording paths between Iroh archive mode and ordinary Git mode. */
export const setMobileAudioGitExclusion = (enabled: boolean): Promise<void> =>
  getRawCore().setMobileAudioGitExclusion(enabled);

const idleTransferProgress: GitTransferProgress = {
  phase: "idle",
  objects_done: 0,
  objects_total: 0,
  bytes: 0,
  remote_text: "",
};

/** Poll while a pull/push runs. Feature-detected: a native module built
 * before this function exists just reports idle instead of crashing. */
export const getGitSyncProgress = (): GitTransferProgress => {
  const raw = getRawCore();
  if (typeof raw.getGitSyncProgress !== "function") {
    return idleTransferProgress;
  }
  try {
    return parse(raw.getGitSyncProgress());
  } catch {
    return idleTransferProgress;
  }
};

// ── Recordings ─────────────────────────────────────────────────────────────────

/** The new note starts with `transcription_status: pending`. */
export const saveAudioRecording = async (
  args: SaveRecordingArgs
): Promise<RecordingWriteResult> =>
  parse(await getRawCore().saveAudioRecording(JSON.stringify(args)));

/** Queue pending/failed recordings for AssemblyAI cloud transcription. */
export const queueRecordingTranscriptions = async (
  args: QueueRecordingsArgs = {}
): Promise<RecordingTranscriptionQueueResult> =>
  parse(await getRawCore().queueRecordingTranscriptions(JSON.stringify(args)));

/**
 * Queue pending/failed recordings against a host-supplied provider (e.g.
 * native on-device speech recognition). Jobs run on the core's background
 * worker, which calls back into `provider`.
 */
export const queueProviderTranscriptions = async (
  provider: RawTranscriptionProvider
): Promise<RecordingTranscriptionQueueResult> =>
  parse(await getRawCore().queueProviderTranscriptions(provider));

export const listRecordings = async (): Promise<RecordingsListResult> =>
  parse(await getRawCore().listRecordings());

export const readRecordingAudio = async (
  path: string
): Promise<RecordingAudioPayload> =>
  parse(await getRawCore().readRecordingAudio(path));

/** Evict phone audio only after age, transcript, and desktop receipt checks. */
export const pruneMobileAudioCache = async (): Promise<MobileAudioPruneResult> =>
  parse(await getRawCore().pruneMobileAudioCache());

// ── Photo attachments ────────────────────────────────────────────────────────

/** Save a photo-backed note as pending. OCR runs after sync on desktop. */
export const saveHandwritingAttachment = async (
  args: SaveHandwritingAttachmentArgs
): Promise<HandwritingAttachmentWriteResult> =>
  parse(await getRawCore().saveHandwritingAttachment(JSON.stringify(args)));

// ── Security ───────────────────────────────────────────────────────────────────

export const getSecurityState = async (): Promise<SecurityState> =>
  parse(await getRawCore().getSecurityState());

export const enableSecurity = async (
  args: EnableSecurityArgs
): Promise<SecurityState> =>
  parse(await getRawCore().enableSecurity(JSON.stringify(args)));

export const lockSecurity = async (): Promise<SecurityState> =>
  parse(await getRawCore().lockSecurity());

/** Entering the panic password wipes local data, exactly as on desktop. */
export const unlockSecurity = async (
  args: UnlockSecurityArgs
): Promise<SecurityUnlockResult> =>
  parse(await getRawCore().unlockSecurity(JSON.stringify(args)));

export const setSecurityPreferences = async (
  args: SetSecurityPreferencesArgs
): Promise<SecurityState> =>
  parse(await getRawCore().setSecurityPreferences(JSON.stringify(args)));
