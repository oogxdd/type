import type {
  NotesListMode,
  ProfileSyncSettings,
  ThemeMode,
} from "@typenotes/shared/types";
import {
  PROFILE_SYNC_STORAGE_KEY,
  DEFAULT_EDITOR_FONT_SIZE,
} from "../constants";

export const DEFAULT_PROFILE_SYNC_SETTINGS: ProfileSyncSettings = {
  gitRemoteUrl: "",
  gitBranch: "main",
  gitUsername: "",
  gitPassword: "",
  gitCommitMessage: "Sync notes",
  lastSuccessfulSyncAt: "",
  noteFileNameFormat: "utc_timestamp_slug",
  assemblyAiApiKey: "",
  mobileAutoTranscriptionEnabled: true,
  whisperModel: "large-v3",
  transcriptionProvider: "whisper",
  handwritingOcrProvider: "local",
  localOcrModelPath: "",
  openAiApiKey: "",
  openAiModel: "gpt-4.1-mini",
  huggingFaceApiKey: "",
  huggingFaceModel: "microsoft/trocr-base-handwritten",
  mobileAutoHandwritingOcrEnabled: true,
};

export const getInitialTheme = (): ThemeMode => {
  if (typeof window === "undefined") {
    return "dark";
  }
  const stored = window.localStorage.getItem("notes-viewer-theme");
  if (stored === "dark" || stored === "light") {
    return stored;
  }
  return "dark";
};

export const getInitialNotesListMode = (): NotesListMode => {
  if (typeof window === "undefined") {
    return "separate";
  }
  const stored = window.localStorage.getItem("notes-viewer-notes-list-mode");
  if (stored === "nested" || stored === "separate") {
    return stored;
  }
  return "separate";
};

export const getInitialHideArchivedFeedNotes = (): boolean => {
  if (typeof window === "undefined") {
    return true;
  }
  const stored = window.localStorage.getItem("notes-viewer-hide-archived-feed-notes");
  if (stored === "true") {
    return true;
  }
  if (stored === "false") {
    return false;
  }
  return true;
};

export const getInitialShowVimModeIndicator = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  const stored = window.localStorage.getItem(
    "notes-viewer-show-vim-mode-indicator"
  );
  return stored === "true";
};

export const getStoredSyncValue = (key: string, fallback: string) => {
  if (typeof window === "undefined") {
    return fallback;
  }
  const stored = window.localStorage.getItem(key);
  return stored && stored.trim().length > 0 ? stored : fallback;
};

export const getStoredBooleanValue = (key: string, fallback: boolean) => {
  if (typeof window === "undefined") {
    return fallback;
  }
  const stored = window.localStorage.getItem(key);
  if (stored === "true") {
    return true;
  }
  if (stored === "false") {
    return false;
  }
  return fallback;
};

const normalizeHandwritingProvider = (
  value: string
): ProfileSyncSettings["handwritingOcrProvider"] =>
  value === "openai" || value === "huggingface" ? value : "local";

const normalizeTranscriptionProvider = (
  value: unknown
): ProfileSyncSettings["transcriptionProvider"] =>
  value === "assemblyai" ? "assemblyai" : "whisper";

const normalizeNoteFileNameFormat = (
  value: unknown
): ProfileSyncSettings["noteFileNameFormat"] => {
  if (value === "uuid_v7" || value === "uuid_v7_prefix_slug") {
    return value;
  }
  return "utc_timestamp_slug";
};

export const readProfileSyncStore = (): Record<string, Partial<ProfileSyncSettings>> => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(PROFILE_SYNC_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, Partial<ProfileSyncSettings>>;
    }
  } catch {
    return {};
  }
  return {};
};

export const writeProfileSyncStore = (store: Record<string, Partial<ProfileSyncSettings>>) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(PROFILE_SYNC_STORAGE_KEY, JSON.stringify(store));
};

export const removeProfileSyncSettings = (profileId: string) => {
  const id = profileId.trim();
  if (!id) {
    return;
  }
  const store = readProfileSyncStore();
  if (!(id in store)) {
    return;
  }
  delete store[id];
  writeProfileSyncStore(store);
};

export const getProfileSyncSettings = (profileId: string): ProfileSyncSettings => {
  const store = readProfileSyncStore();
  const stored = store[profileId] ?? {};
  const legacyFallback =
    profileId === "default"
      ? {
          gitRemoteUrl: getStoredSyncValue("notes-viewer-git-remote", ""),
          gitBranch: getStoredSyncValue("notes-viewer-git-branch", "main"),
          gitUsername: getStoredSyncValue("notes-viewer-git-username", ""),
          gitPassword: getStoredSyncValue("notes-viewer-git-password", ""),
          gitCommitMessage: getStoredSyncValue("notes-viewer-git-commit-message", "Sync notes"),
          lastSuccessfulSyncAt: getStoredSyncValue("notes-viewer-git-last-sync-at", ""),
          noteFileNameFormat: normalizeNoteFileNameFormat(
            getStoredSyncValue(
              "notes-viewer-note-file-name-format",
              DEFAULT_PROFILE_SYNC_SETTINGS.noteFileNameFormat
            )
          ),
          assemblyAiApiKey: getStoredSyncValue("notes-viewer-assemblyai-api-key", ""),
          mobileAutoTranscriptionEnabled: getStoredBooleanValue(
            "notes-viewer-mobile-auto-transcription-enabled",
            DEFAULT_PROFILE_SYNC_SETTINGS.mobileAutoTranscriptionEnabled
          ),
          handwritingOcrProvider: normalizeHandwritingProvider(
            getStoredSyncValue(
              "notes-viewer-handwriting-ocr-provider",
              DEFAULT_PROFILE_SYNC_SETTINGS.handwritingOcrProvider
            )
          ),
          openAiApiKey: getStoredSyncValue("notes-viewer-openai-api-key", ""),
          openAiModel: getStoredSyncValue(
            "notes-viewer-openai-model",
            DEFAULT_PROFILE_SYNC_SETTINGS.openAiModel
          ),
          huggingFaceApiKey: getStoredSyncValue("notes-viewer-huggingface-api-key", ""),
          huggingFaceModel: getStoredSyncValue(
            "notes-viewer-huggingface-model",
            DEFAULT_PROFILE_SYNC_SETTINGS.huggingFaceModel
          ),
          mobileAutoHandwritingOcrEnabled: getStoredBooleanValue(
            "notes-viewer-mobile-auto-handwriting-ocr-enabled",
            DEFAULT_PROFILE_SYNC_SETTINGS.mobileAutoHandwritingOcrEnabled
          ),
        }
      : {};

  return {
    gitRemoteUrl: stored.gitRemoteUrl ?? legacyFallback.gitRemoteUrl ?? DEFAULT_PROFILE_SYNC_SETTINGS.gitRemoteUrl,
    gitBranch: stored.gitBranch ?? legacyFallback.gitBranch ?? DEFAULT_PROFILE_SYNC_SETTINGS.gitBranch,
    gitUsername: stored.gitUsername ?? legacyFallback.gitUsername ?? DEFAULT_PROFILE_SYNC_SETTINGS.gitUsername,
    gitPassword: stored.gitPassword ?? legacyFallback.gitPassword ?? DEFAULT_PROFILE_SYNC_SETTINGS.gitPassword,
    gitCommitMessage:
      stored.gitCommitMessage ??
      legacyFallback.gitCommitMessage ??
      DEFAULT_PROFILE_SYNC_SETTINGS.gitCommitMessage,
    lastSuccessfulSyncAt:
      stored.lastSuccessfulSyncAt ??
      legacyFallback.lastSuccessfulSyncAt ??
      DEFAULT_PROFILE_SYNC_SETTINGS.lastSuccessfulSyncAt,
    noteFileNameFormat: normalizeNoteFileNameFormat(
      stored.noteFileNameFormat ??
        legacyFallback.noteFileNameFormat ??
        DEFAULT_PROFILE_SYNC_SETTINGS.noteFileNameFormat
    ),
    assemblyAiApiKey:
      stored.assemblyAiApiKey ??
      legacyFallback.assemblyAiApiKey ??
      DEFAULT_PROFILE_SYNC_SETTINGS.assemblyAiApiKey,
    mobileAutoTranscriptionEnabled:
      stored.mobileAutoTranscriptionEnabled ??
      legacyFallback.mobileAutoTranscriptionEnabled ??
      DEFAULT_PROFILE_SYNC_SETTINGS.mobileAutoTranscriptionEnabled,
    whisperModel:
      stored.whisperModel ?? DEFAULT_PROFILE_SYNC_SETTINGS.whisperModel,
    transcriptionProvider: normalizeTranscriptionProvider(
      stored.transcriptionProvider ??
        DEFAULT_PROFILE_SYNC_SETTINGS.transcriptionProvider
    ),
    handwritingOcrProvider: normalizeHandwritingProvider(
      stored.handwritingOcrProvider ??
        legacyFallback.handwritingOcrProvider ??
        DEFAULT_PROFILE_SYNC_SETTINGS.handwritingOcrProvider
    ),
    localOcrModelPath:
      stored.localOcrModelPath ?? DEFAULT_PROFILE_SYNC_SETTINGS.localOcrModelPath,
    openAiApiKey:
      stored.openAiApiKey ??
      legacyFallback.openAiApiKey ??
      DEFAULT_PROFILE_SYNC_SETTINGS.openAiApiKey,
    openAiModel:
      stored.openAiModel ??
      legacyFallback.openAiModel ??
      DEFAULT_PROFILE_SYNC_SETTINGS.openAiModel,
    huggingFaceApiKey:
      stored.huggingFaceApiKey ??
      legacyFallback.huggingFaceApiKey ??
      DEFAULT_PROFILE_SYNC_SETTINGS.huggingFaceApiKey,
    huggingFaceModel:
      stored.huggingFaceModel ??
      legacyFallback.huggingFaceModel ??
      DEFAULT_PROFILE_SYNC_SETTINGS.huggingFaceModel,
    mobileAutoHandwritingOcrEnabled:
      stored.mobileAutoHandwritingOcrEnabled ??
      legacyFallback.mobileAutoHandwritingOcrEnabled ??
      DEFAULT_PROFILE_SYNC_SETTINGS.mobileAutoHandwritingOcrEnabled,
  };
};

export const getInitialEditorFontSize = (): number => {
  if (typeof window === "undefined") {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
  const stored = window.localStorage.getItem("notes-viewer-editor-font-size");
  if (stored) {
    const parsed = Number(stored);
    if (!Number.isNaN(parsed) && parsed >= 12 && parsed <= 28) {
      return parsed;
    }
  }
  return DEFAULT_EDITOR_FONT_SIZE;
};

// Persisted note-preview snapshots (one localStorage key per profile). Shared so
// the security feature can purge plaintext previews when encryption is enabled.
export const NOTE_PREVIEW_CACHE_PREFIX = "notes-viewer-note-previews-v1:";

export const clearPersistedNotePreviews = () => {
  if (typeof window === "undefined") {
    return;
  }
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(NOTE_PREVIEW_CACHE_PREFIX)) {
      window.localStorage.removeItem(key);
    }
  }
};
