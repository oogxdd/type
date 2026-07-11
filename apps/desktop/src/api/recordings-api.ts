import { open } from "@tauri-apps/plugin-dialog";
import { invokeLogged } from "./invoke";
import type {
  NoteFileNameFormat,
  RecordingAudioPayload,
  RecordingsListResult,
  RecordingTranscriptionQueueResult,
  RecordingWriteResult,
  WhisperStatusResult,
} from "@typenotes/shared/types";

export type ImportAudioFilesArgs = {
  source_paths: string[];
  target_folder?: string;
  file_name_format: NoteFileNameFormat;
};

/** Pollable bulk-import progress (see backend `AudioImportState`). */
export type AudioImportState = {
  running: boolean;
  done: boolean;
  total: number;
  processed: number;
  imported: number;
  failed: number;
  current: string;
  target_folder: string;
  error: string | null;
  errors: string[];
};

export const saveAudioRecording = (
  audioBase64: string,
  mimeType?: string,
  folderPath?: string,
  fileNameFormat?: NoteFileNameFormat
): Promise<RecordingWriteResult> =>
  invokeLogged<RecordingWriteResult>("save_audio_recording", {
    args: {
      audio_base64: audioBase64,
      mime_type: mimeType,
      folder_path: folderPath,
      file_name_format: fileNameFormat,
    },
  });

export const queueLocalTranscriptions = (
  model?: string
): Promise<RecordingTranscriptionQueueResult> =>
  invokeLogged<RecordingTranscriptionQueueResult>("queue_local_transcriptions", {
    args: {
      model: model || "large-v3",
    },
  });

export const retriggerTranscription = (
  notePath: string,
  model?: string
): Promise<void> =>
  invokeLogged<void>("retrigger_transcription", {
    args: {
      note_path: notePath,
      model,
    },
  });

export const checkWhisperStatus = (
  model?: string,
  setup?: boolean
): Promise<WhisperStatusResult> =>
  invokeLogged<WhisperStatusResult>("check_whisper_status", {
    args: { model, setup: setup ?? false },
  });

export const listRecordings = (): Promise<RecordingsListResult> =>
  invokeLogged<RecordingsListResult>("list_recordings");

export const readRecordingAudio = (
  path: string
): Promise<RecordingAudioPayload> =>
  invokeLogged<RecordingAudioPayload>("read_recording_audio", {
    args: { path },
  });

// Server-side validated absolute path, for use with Tauri's asset protocol.
export const resolveRecordingAudioPath = (path: string): Promise<string> =>
  invokeLogged<string>("resolve_recording_audio_path", { args: { path } });

/** Open the native file picker (single or multi-select) for audio files. */
export const pickAudioFiles = async (): Promise<string[]> => {
  const selected = await open({
    multiple: true,
    directory: false,
    filters: [
      { name: "Audio", extensions: ["m4a", "mp3", "wav", "ogg", "flac", "aac", "webm", "mp4"] },
    ],
    title: "Choose audio file(s) to import",
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
};

export const importAudioFiles = (args: ImportAudioFilesArgs): Promise<void> =>
  invokeLogged("import_audio_files", { args });

export const getAudioImportStatus = (): Promise<AudioImportState> =>
  invokeLogged<AudioImportState>("audio_import_status");
