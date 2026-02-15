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

export type RecordingWriteResult = {
  recording_folder: string;
  audio_path: string;
  transcript_path: string;
  status_path: string;
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
  recording_folder: string;
  audio_path: string | null;
  transcript_path: string;
  status_path: string;
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

 
