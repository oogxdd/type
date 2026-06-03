import { invokeLogged } from "@/data/invoke";
import type {
  NativeRecorderCapabilities,
  NoteFileNameFormat,
  RecordingAudioPayload,
  RecordingsListResult,
  RecordingTranscriptionQueueResult,
  RecordingWriteResult,
  WhisperStatusResult,
} from "@/types";

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

export const queueRecordingTranscriptions = (
  assemblyApiKey: string
): Promise<RecordingTranscriptionQueueResult> =>
  invokeLogged<RecordingTranscriptionQueueResult>("queue_recording_transcriptions", {
    args: {
      assembly_api_key: assemblyApiKey,
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

export const nativeRecorderCapabilities =
  (): Promise<NativeRecorderCapabilities> =>
    invokeLogged<NativeRecorderCapabilities>(
      "native_audio_recorder_capabilities"
    );

export const startNativeAudioRecording = (): Promise<void> =>
  invokeLogged<void>("start_native_audio_recording");

export const stopNativeAudioRecording = (): Promise<RecordingAudioPayload> =>
  invokeLogged<RecordingAudioPayload>("stop_native_audio_recording");
