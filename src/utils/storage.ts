import type { ThemeMode, NotesListMode } from "../components/SettingsPanel";
import type { ProfileSyncSettings } from "../types";
import {
  PROFILE_SYNC_STORAGE_KEY,
  OTA_AUTO_CHECK_STORAGE_KEY,
  DEFAULT_EDITOR_FONT_SIZE,
} from "../constants";

export const DEFAULT_PROFILE_SYNC_SETTINGS: ProfileSyncSettings = {
  gitRemoteUrl: "",
  gitBranch: "main",
  gitUsername: "",
  gitPassword: "",
  gitCommitMessage: "Sync notes",
  lastSuccessfulSyncAt: "",
  assemblyAiApiKey: "",
  mobileAutoTranscriptionEnabled: true,
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
          assemblyAiApiKey: getStoredSyncValue("notes-viewer-assemblyai-api-key", ""),
          mobileAutoTranscriptionEnabled: getStoredBooleanValue(
            "notes-viewer-mobile-auto-transcription-enabled",
            DEFAULT_PROFILE_SYNC_SETTINGS.mobileAutoTranscriptionEnabled
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
    assemblyAiApiKey:
      stored.assemblyAiApiKey ??
      legacyFallback.assemblyAiApiKey ??
      DEFAULT_PROFILE_SYNC_SETTINGS.assemblyAiApiKey,
    mobileAutoTranscriptionEnabled:
      stored.mobileAutoTranscriptionEnabled ??
      legacyFallback.mobileAutoTranscriptionEnabled ??
      DEFAULT_PROFILE_SYNC_SETTINGS.mobileAutoTranscriptionEnabled,
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

export const getOtaAutoCheckEnabled = (): boolean => {
  if (typeof window === "undefined") {
    return true;
  }
  const stored = window.localStorage.getItem(OTA_AUTO_CHECK_STORAGE_KEY);
  if (stored === "false") {
    return false;
  }
  return true;
};

export const setOtaAutoCheckEnabled = (enabled: boolean) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(OTA_AUTO_CHECK_STORAGE_KEY, String(enabled));
};
