export type SettingsSectionId =
  | "general"
  | "profile"
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

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "general", title: "General" },
  { id: "profile", title: "Profile" },
  { id: "sync", title: "Sync" },
  { id: "updates", title: "Updates" },
  { id: "appearance", title: "Appearance" },
  { id: "transcription", title: "Transcription" },
  { id: "recordings", title: "Recordings" },
  { id: "security", title: "Security" },
];

// Sections shown in the mobile settings screen (no "transcription" tab on mobile).
export const MOBILE_SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string }> = [
  { id: "general", label: "General" },
  { id: "profile", label: "Profile" },
  { id: "sync", label: "Sync" },
  { id: "updates", label: "Updates" },
  { id: "appearance", label: "Appearance" },
  { id: "recordings", label: "Recordings" },
  { id: "security", label: "Security" },
];
