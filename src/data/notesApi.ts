import { invoke } from "@tauri-apps/api/core";
import type {
  CreateNoteResult,
  FolderNode,
  GitCommitHistoryEntry,
  GitSyncStatus,
  HandwritingAttachmentWriteResult,
  HandwritingOcrListResult,
  HandwritingOcrQueueResult,
  NativeRecorderCapabilities,
  NoteMeta,
  NotesProfile,
  NotesProfileSnapshot,
  RecordingAudioPayload,
  RecordingsListResult,
  RecordingTranscriptionQueueResult,
  RecordingWriteResult,
} from "../types";

const LOG_PREFIX = "[notes]";
const SENSITIVE_PATTERN = /(password|token|secret|api.?key|authorization)/i;

type NotesProfilesSnapshotPayload = {
  active_profile_id: string;
  profiles: NotesProfile[];
};

const sanitizeForLog = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeForLog);
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
      if (SENSITIVE_PATTERN.test(key)) {
        next[key] = "[REDACTED]";
      } else {
        next[key] = sanitizeForLog(nested);
      }
    });
    return next;
  }
  return value;
};

const invokeLogged = async <T,>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> => {
  console.groupCollapsed(`${LOG_PREFIX} invoke ${command}`);
  if (args) {
    console.log("args", sanitizeForLog(args));
  }
  try {
    const result = await invoke<T>(command, args);
    console.log("result", result);
    console.groupEnd();
    return result;
  } catch (error) {
    console.error("error", error);
    console.groupEnd();
    throw error;
  }
};

export const logGroup = (label: string, data?: Record<string, unknown>) => {
  console.groupCollapsed(`${LOG_PREFIX} ${label}`);
  if (data) {
    console.log(data);
  }
  console.groupEnd();
};

export const getTree = (): Promise<FolderNode> =>
  invokeLogged<FolderNode>("get_tree");

export const readNote = (path: string): Promise<string> =>
  invokeLogged<string>("read_note", { path });

export const createNote = (
  folderPath?: string,
  content = "",
  timestampMs?: number
): Promise<CreateNoteResult> =>
  invokeLogged<CreateNoteResult>("create_note", {
    args: {
      folder_path: folderPath,
      content,
      timestamp_ms: timestampMs,
    },
  });

export const writeNote = (path: string, content: string): Promise<void> =>
  invokeLogged("write_note", { path, content });

export const setNoteTimestamp = (path: string, timestampMs: number): Promise<void> =>
  invokeLogged("set_note_timestamp", {
    args: {
      path,
      timestamp_ms: timestampMs,
    },
  });

export const saveAudioRecording = (
  audioBase64: string,
  mimeType?: string,
  folderPath?: string
): Promise<RecordingWriteResult> =>
  invokeLogged<RecordingWriteResult>("save_audio_recording", {
    args: {
      audio_base64: audioBase64,
      mime_type: mimeType,
      folder_path: folderPath,
    },
  });

export const saveHandwritingAttachment = (
  imageBase64: string,
  mimeType?: string,
  fileName?: string,
  folderPath?: string
): Promise<HandwritingAttachmentWriteResult> =>
  invokeLogged<HandwritingAttachmentWriteResult>("save_handwriting_attachment", {
    args: {
      image_base64: imageBase64,
      mime_type: mimeType,
      file_name: fileName,
      folder_path: folderPath,
    },
  });

export const queueRecordingTranscriptions = (
  assemblyApiKey: string
): Promise<RecordingTranscriptionQueueResult> =>
  invokeLogged<RecordingTranscriptionQueueResult>("queue_recording_transcriptions", {
    args: {
      assembly_api_key: assemblyApiKey,
    },
  });

export const queueHandwritingOcr = (
  provider: "openai" | "huggingface",
  apiKey: string,
  model: string
): Promise<HandwritingOcrQueueResult> =>
  invokeLogged<HandwritingOcrQueueResult>("queue_handwriting_ocr", {
    args: {
      provider,
      api_key: apiKey,
      model,
    },
  });

export const listRecordings = (): Promise<RecordingsListResult> =>
  invokeLogged<RecordingsListResult>("list_recordings");

export const listHandwritingOcrJobs = (): Promise<HandwritingOcrListResult> =>
  invokeLogged<HandwritingOcrListResult>("list_handwriting_ocr_jobs");

export const readRecordingAudio = (
  path: string
): Promise<RecordingAudioPayload> =>
  invokeLogged<RecordingAudioPayload>("read_recording_audio", {
    args: { path },
  });

export const nativeRecorderCapabilities =
  (): Promise<NativeRecorderCapabilities> =>
    invokeLogged<NativeRecorderCapabilities>(
      "native_audio_recorder_capabilities"
    );

export const startNativeAudioRecording = (): Promise<void> =>
  invokeLogged<void>("start_native_audio_recording");

export const stopNativeAudioRecording = (): Promise<RecordingAudioPayload> =>
  invokeLogged<RecordingAudioPayload>("stop_native_audio_recording");

export const getNoteMeta = (path: string): Promise<NoteMeta> =>
  invokeLogged<NoteMeta>("get_note_meta", { path });

export const deleteItems = (items: string[]): Promise<void> =>
  invokeLogged("delete_items", { items });

export const moveItems = (items: string[], destination: string): Promise<void> =>
  invokeLogged("move_items", { items, destination });

export const renameItem = (path: string, newName: string): Promise<string> =>
  invokeLogged<string>("rename_item", { path, newName });

export type SetOrderArgs = {
  parent: string;
  folderOrder: string[];
  noteOrder: string[];
};

export const setOrder = (args: SetOrderArgs): Promise<void> =>
  invokeLogged("set_order", { args });

export const getGitStatus = (): Promise<GitSyncStatus> =>
  invokeLogged<GitSyncStatus>("get_git_status");

export const getGitHistory = (limit = 40): Promise<GitCommitHistoryEntry[]> =>
  invokeLogged<GitCommitHistoryEntry[]>("get_git_history", {
    args: { limit },
  });

const normalizeProfilesSnapshot = (
  payload: NotesProfilesSnapshotPayload
): NotesProfileSnapshot => ({
  activeProfileId: payload.active_profile_id,
  profiles: payload.profiles,
});

export const getProfiles = async (): Promise<NotesProfileSnapshot> =>
  normalizeProfilesSnapshot(
    await invokeLogged<NotesProfilesSnapshotPayload>("get_profiles")
  );

export const createProfile = async (
  name: string,
  description?: string
): Promise<NotesProfileSnapshot> =>
  normalizeProfilesSnapshot(
    await invokeLogged<NotesProfilesSnapshotPayload>("create_profile", {
      args: { name, description },
    })
  );

export const setActiveProfile = (
  profileId: string
): Promise<NotesProfileSnapshot> =>
  invokeLogged<NotesProfilesSnapshotPayload>("set_active_profile", {
    args: { profile_id: profileId },
  }).then(normalizeProfilesSnapshot);

export const setProfileNotesRoot = (
  profileId: string,
  notesRoot: string
): Promise<NotesProfileSnapshot> =>
  invokeLogged<NotesProfilesSnapshotPayload>("set_profile_notes_root", {
    args: {
      profile_id: profileId,
      notes_root: notesRoot,
    },
  }).then(normalizeProfilesSnapshot);

export const updateProfile = (
  profileId: string,
  patch: { name?: string; description?: string }
): Promise<NotesProfileSnapshot> =>
  invokeLogged<NotesProfilesSnapshotPayload>("update_profile", {
    args: {
      profile_id: profileId,
      ...patch,
    },
  }).then(normalizeProfilesSnapshot);

export const deleteProfile = (profileId: string): Promise<NotesProfileSnapshot> =>
  invokeLogged<NotesProfilesSnapshotPayload>("delete_profile", {
    args: { profile_id: profileId },
  }).then(normalizeProfilesSnapshot);

export const connectGitRepo = (
  remoteUrl: string,
  branch?: string,
  username?: string,
  password?: string
): Promise<GitSyncStatus> =>
  invokeLogged<GitSyncStatus>("connect_git_repo", {
    args: {
      remote_url: remoteUrl,
      branch,
      username,
      password,
    },
  });

export const gitPull = (
  branch?: string,
  username?: string,
  password?: string
): Promise<GitSyncStatus> =>
  invokeLogged<GitSyncStatus>("git_pull", {
    args: {
      branch,
      username,
      password,
    },
  });

export const gitPush = (
  message?: string,
  branch?: string,
  username?: string,
  password?: string
): Promise<GitSyncStatus> =>
  invokeLogged<GitSyncStatus>("git_push", {
    args: {
      message,
      branch,
      username,
      password,
    },
  });
