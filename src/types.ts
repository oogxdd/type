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
};

export type NotesProfileSnapshot = {
  activeProfileId: string;
  profiles: NotesProfile[];
};

export type RecordingWriteResult = {
  folder_path: string;
  note_path: string;
  audio_path: string;
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

export type RecordingQueueSnapshot = {
  running: boolean;
  current_recording: string | null;
  pending: string[];
  in_flight: number;
};

export type RecordingListItem = {
  note_path: string;
  folder_path: string;
  audio_path: string | null;
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

export type RecordingAudioPayload = {
  mime_type: string;
  audio_base64: string;
};

export type NativeRecorderCapabilities = {
  supported: boolean;
  recording: boolean;
  started_ms: number | null;
};

export type AppMode = "notes" | "settings";
export type PaneId = "folders" | "middle" | "right";
export type GitSyncAction = "idle" | "refresh" | "connect" | "pull" | "push";

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

export type ProfileSyncSettings = {
  gitRemoteUrl: string;
  gitBranch: string;
  gitUsername: string;
  gitPassword: string;
  gitCommitMessage: string;
  lastSuccessfulSyncAt: string;
  assemblyAiApiKey: string;
  mobileAutoTranscriptionEnabled: boolean;
};
