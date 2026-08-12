export type ThemeMode = "light" | "dark";
export type NotesListMode = "separate" | "nested";

export type NoteEntry = {
  name: string;
  path: string;
};

export type FolderNode = {
  name: string;
  path: string;
  children: FolderNode[];
  notes: NoteEntry[];
};

export type NoteMeta = {
  created_ms: number | null;
  updated_ms: number | null;
  note_type?: string | null;
  archived_ms?: number | null;
  reviewed_ms?: number | null;
  recording_audio_path?: string | null;
  handwriting_attachment_path?: string | null;
  transcription_status?: string | null;
  transcription_error?: string | null;
  transcription_updated_ms?: number | null;
  ocr_status?: string | null;
  ocr_error?: string | null;
  ocr_updated_ms?: number | null;
};

export type NotePreviewEntry = {
  path: string;
  content: string;
  meta: NoteMeta;
};

export type DragData = {
  type: "folder" | "note";
  path: string;
};

export type GitSyncStatus = {
  git_available: boolean;
  repo_initialized: boolean;
  current_branch: string | null;
  remote_url: string | null;
  has_uncommitted_changes: boolean;
  push_required: boolean;
  ahead: number;
  behind: number;
  notes_root: string;
};

export type LocalSyncServerStatus = {
  supported: boolean;
  git_available: boolean;
  running: boolean;
  host: string | null;
  port: number;
  branch: string | null;
  ssh_url: string | null;
  host_key_sha256: string | null;
  iroh_ticket: string | null;
  iroh_endpoint_id: string | null;
  paired_devices: PairedDeviceInfo[];
  repo_path: string;
  error: string | null;
};

export type IrohDocsSyncStatus = {
  configured: boolean;
  running: boolean;
  profile_id: string;
  document_id: string | null;
  endpoint_id: string | null;
  peer_configured: boolean;
  phase:
    | "disabled"
    | "stopped"
    | "running"
    | "saved_locally"
    | "syncing"
    | "synced"
    | "waiting_for_peer"
    | "error"
    | string;
  last_sync_ms: number | null;
  last_error: string | null;
  neighbors: number;
};

export type IrohDocsPairingBundle = {
  write_doc_ticket: string;
  vault_key: string;
  peer_endpoint_ticket: string | null;
};

export type IrohDocsBootstrapResult = {
  status: IrohDocsSyncStatus;
  pairing: IrohDocsPairingBundle;
  peer_read_doc_ticket: string;
};

export type IrohDocsSyncResult = {
  published: number;
  unchanged: number;
  tombstones: number;
  applied: number;
  conflicts: number;
  entries_received: number;
  entries_sent: number;
  connected: boolean;
};

export type ConfigureIrohDocsSyncArgs = {
  write_doc_ticket: string;
  vault_key: string;
  peer_endpoint_ticket?: string | null;
};

export type SetIrohDocsSyncPeerArgs = {
  peer_endpoint_ticket?: string | null;
};

export type PairedDeviceInfo = {
  name: string;
  added_ms: number;
};

export type GitTransferProgressPhase = "idle" | "receiving" | "indexing" | "pushing";

export type GitTransferProgress = {
  phase: GitTransferProgressPhase;
  objects_done: number;
  objects_total: number;
  bytes: number;
  remote_text: string;
};

export type DiscoveredServer = {
  name: string;
  host: string;
  port: number;
  url: string;
  branch: string;
};

export type GitCommitHistorySyncState = "synced" | "local";

export type GitCommitHistoryEntry = {
  id: string;
  short_id: string;
  summary: string;
  author: string;
  authored_ms: number | null;
  sync_state: GitCommitHistorySyncState;
  is_head: boolean;
};

export type NotesProfile = {
  id: string;
  name: string;
  description: string;
  notes_root: string;
  settings: ProfileSettings;
};

export type AppConfig = {
  assemblyai_api_key: string;
  whisper_model: string;
  handwriting_ocr_provider: string;
  local_ocr_model_path: string;
  openai_api_key: string;
  openai_model: string;
  huggingface_api_key: string;
  huggingface_model: string;
  note_file_name_format: string;
};

export type NotesProfileSnapshot = {
  activeProfileId: string;
  profiles: NotesProfile[];
  appConfig: AppConfig;
};

export type ProfilesBackupArchive = {
  archive_path: string;
  archive_name: string;
  profile_count: number;
  file_count: number;
  total_bytes: number;
};

export type ProfilesDocumentsExport = {
  export_path: string;
  export_name: string;
  profile_count: number;
  file_count: number;
  total_bytes: number;
};

export type RecordingWriteResult = {
  folder_path: string;
  note_path: string;
  audio_path: string;
};

export type HandwritingAttachmentWriteResult = {
  folder_path: string;
  note_path: string;
  attachment_path: string;
};

export type CreateNoteResult = {
  path: string;
};

export type RecordingTranscriptionQueueResult = {
  scanned: number;
  queued: number;
  skipped: number;
  in_flight: number;
};

export type HandwritingOcrQueueResult = {
  scanned: number;
  queued: number;
  skipped: number;
  in_flight: number;
};

export type TranscriptionProgress = {
  processed_seconds: number;
  total_seconds: number;
};

export type RecordingQueueSnapshot = {
  running: boolean;
  current_recording: string | null;
  pending: string[];
  in_flight: number;
  progress: TranscriptionProgress | null;
};

export type HandwritingOcrQueueSnapshot = {
  running: boolean;
  current_note: string | null;
  pending: string[];
  in_flight: number;
};

export type RecordingListItem = {
  note_path: string;
  folder_path: string;
  audio_path: string | null;
  archived_on_desktop: boolean;
  status: string;
  error: string | null;
  updated_ms: number | null;
  is_queued: boolean;
  is_processing: boolean;
};

export type HandwritingOcrListItem = {
  note_path: string;
  folder_path: string;
  attachment_path: string | null;
  status: string;
  error: string | null;
  updated_ms: number | null;
  is_queued: boolean;
  is_processing: boolean;
};

export type RecordingsListResult = {
  queue: RecordingQueueSnapshot;
  recordings: RecordingListItem[];
};

export type HandwritingOcrListResult = {
  queue: HandwritingOcrQueueSnapshot;
  jobs: HandwritingOcrListItem[];
};

export type RecordingAudioPayload = {
  mime_type: string;
  audio_base64: string;
};

export type MobileAudioPruneResult = {
  scanned: number;
  evicted: number;
  already_evicted: number;
  waiting_for_age: number;
  waiting_for_transcription: number;
  waiting_for_desktop_receipt: number;
  waiting_for_git_migration: number;
};

export type WhisperStatusResult = {
  available: boolean;
  python_found: boolean;
  error: string | null;
};

export type LocalOcrStatusResult = {
  available: boolean;
  python_found: boolean;
  model_path: string;
  error: string | null;
};

export type NativeRecorderCapabilities = {
  supported: boolean;
  recording: boolean;
  started_ms: number | null;
};

export type SetOrderArgs = {
  parent: string;
  folderOrder: string[];
  noteOrder: string[];
};

export type SetNoteMarkersArgs = {
  path: string;
  archived?: boolean | null;
  reviewed?: boolean | null;
};

export type AppMode = "notes" | "settings";
export type PaneId = "folders" | "middle" | "right";
export type GitSyncAction =
  | "idle"
  | "refresh"
  | "connect"
  | "pull"
  | "push"
  | "sync";
export type NoteFileNameFormat =
  | "utc_timestamp_slug"
  | "uuid_v7"
  | "uuid_v7_prefix_slug";

export type VisibleNavigationItem =
  | {
      type: "folder";
      id: string;
      parentId: string | null;
    }
  | {
      type: "note";
      id: string;
      parentId: string;
    };

// Where recordings made in a working folder get transcribed. Stored in the
// folder's own .type/settings.json, so it syncs across devices. Absent means
// "not chosen yet": the effective mode falls back to the legacy
// mobile_auto_transcription_enabled flag (true → assemblyai, false → desktop).
export type TranscriptionMode = "off" | "desktop" | "assemblyai" | "native";

export type ProfileSettings = {
  git_remote_url: string;
  git_branch: string;
  git_username: string;
  git_password: string;
  git_commit_message: string;
  git_trusted_ssh_host: string;
  git_trusted_ssh_host_key_sha256: string;
  /** Device-local endpoint ticket; empty means ordinary Git transport. */
  git_iroh_ticket: string;
  mobile_auto_transcription_enabled: boolean;
  mobile_auto_handwriting_ocr_enabled: boolean;
  transcription_mode?: TranscriptionMode | null;
};

export const effectiveTranscriptionMode = (
  settings: Pick<
    ProfileSettings,
    "transcription_mode" | "mobile_auto_transcription_enabled"
  >
): TranscriptionMode =>
  settings.transcription_mode ??
  (settings.mobile_auto_transcription_enabled ? "assemblyai" : "desktop");

export type ProfileSyncSettings = {
  gitRemoteUrl: string;
  gitBranch: string;
  gitUsername: string;
  gitPassword: string;
  gitCommitMessage: string;
  lastSuccessfulSyncAt: string;
  noteFileNameFormat: NoteFileNameFormat;
  assemblyAiApiKey: string;
  mobileAutoTranscriptionEnabled: boolean;
  whisperModel: string;
  handwritingOcrProvider: "local" | "openai" | "huggingface";
  localOcrModelPath: string;
  openAiApiKey: string;
  openAiModel: string;
  huggingFaceApiKey: string;
  huggingFaceModel: string;
  mobileAutoHandwritingOcrEnabled: boolean;
};

export type SecurityState = {
  encryption_enabled: boolean;
  locked: boolean;
  auto_lock_on_background: boolean;
};

export type SecurityUnlockResult = {
  unlocked: boolean;
  panic_triggered: boolean;
  reset_required: boolean;
  message?: string | null;
};

// ── FFI / IPC argument shapes ──────────────────────────────────────────────────
// These mirror the serde arg structs in crates/type-core. The desktop Tauri
// commands and the mobile FFI (crates/type-ffi) both deserialize exactly these.

export type CreateNoteArgs = {
  folder_path?: string | null;
  content?: string | null;
  timestamp_ms?: number | null;
  file_name_format?: NoteFileNameFormat;
};

export type SetNoteTimestampArgs = {
  path: string;
  timestamp_ms: number;
};

export type SaveRecordingArgs = {
  audio_base64: string;
  mime_type?: string | null;
  folder_path?: string | null;
  file_name_format?: NoteFileNameFormat;
};

export type SaveHandwritingAttachmentArgs = {
  image_base64: string;
  mime_type?: string | null;
  file_name?: string | null;
  folder_path?: string | null;
  file_name_format?: NoteFileNameFormat;
};

export type QueueRecordingsArgs = {
  assembly_api_key?: string | null;
};

export type ConnectGitArgs = {
  remote_url?: string | null;
  branch?: string | null;
  username?: string | null;
  password?: string | null;
};

export type GitSyncArgs = {
  branch?: string | null;
  username?: string | null;
  password?: string | null;
};

export type GitPushArgs = {
  message?: string | null;
  branch?: string | null;
  username?: string | null;
  password?: string | null;
};

export type StartIrohClientArgs = {
  ticket: string;
  remote_url: string;
};

export type IrohClientStatus = {
  running: boolean;
  local_port: number;
  local_remote_url: string;
  endpoint_id: string;
};

export type IrohAudioArchiveResult = {
  scanned: number;
  uploaded: number;
  already_archived: number;
};

export type GitHistoryArgs = {
  limit?: number | null;
};

export type CreateProfileArgs = {
  name: string;
  description?: string | null;
};

export type UpdateProfileArgs = {
  profile_id: string;
  name?: string | null;
  description?: string | null;
};

export type UpdateProfileSettingsArgs = {
  profile_id: string;
  settings: ProfileSettings;
};

export type UpdateAppConfigArgs = {
  config: AppConfig;
};

export type EnableSecurityArgs = {
  unlock_password: string;
  panic_password: string;
};

export type UnlockSecurityArgs = {
  password: string;
};

export type SetSecurityPreferencesArgs = {
  auto_lock_on_background: boolean;
};

// Wire shape of the Rust NotesProfilesSnapshot (snake_case, as serialized).
export type ProfilesSnapshot = {
  active_profile_id: string;
  profiles: NotesProfile[];
  app_config: AppConfig;
};
