import type { SettingsSectionId } from "./components/SettingsPanel";

export const indentationWidth = 18;
export const FEED_FOLDER_PATH = "Feed";
export const ARCHIEVE_FOLDER_PATH = "Archieve";
export const SYSTEM_FOLDER_PATHS = new Set([FEED_FOLDER_PATH, ARCHIEVE_FOLDER_PATH]);

export const PROFILE_SYNC_STORAGE_KEY = "notes-viewer-profile-sync-settings";
export const OTA_AUTO_CHECK_STORAGE_KEY = "notes-viewer-ota-auto-check-enabled";

export const DEFAULT_EDITOR_FONT_SIZE = 14;
export const MIN_EDITOR_FONT_SIZE = 12;
export const MAX_EDITOR_FONT_SIZE = 28;

export const MOBILE_SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "sync", label: "Sync" },
  { id: "appearance", label: "Appearance" },
  { id: "recordings", label: "Recordings" },
];

export const isSystemFolder = (path: string) => SYSTEM_FOLDER_PATHS.has(path);
