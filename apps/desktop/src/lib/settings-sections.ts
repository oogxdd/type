import { APP_EXTENSIONS } from "./extensions";

export type SettingsSectionId =
  | "general"
  | "profile"
  | "import"
  | "sync"
  | "updates"
  | "appearance"
  | "transcription"
  | "recordings"
  | "security";

export type SettingsSection = {
  id: SettingsSectionId;
  title: string;
};

const SECURITY_SETTINGS_SECTIONS: SettingsSection[] = APP_EXTENSIONS.security
  ? [{ id: "security", title: "Security" }]
  : [];

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "general", title: "General" },
  { id: "profile", title: "Profile" },
  { id: "import", title: "Import" },
  { id: "sync", title: "Sync" },
  { id: "updates", title: "Updates" },
  { id: "appearance", title: "Appearance" },
  { id: "transcription", title: "Transcription" },
  { id: "recordings", title: "Recordings" },
  ...SECURITY_SETTINGS_SECTIONS,
];
