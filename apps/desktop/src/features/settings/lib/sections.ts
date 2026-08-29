import { APP_EXTENSIONS } from "@/features/extensions/registry";

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

export function getAdjacentSettingsSectionId(
  activeId: SettingsSectionId,
  direction: -1 | 1
): SettingsSectionId {
  const currentIndex = SETTINGS_SECTIONS.findIndex((section) => section.id === activeId);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = Math.max(
    0,
    Math.min(SETTINGS_SECTIONS.length - 1, safeIndex + direction)
  );
  return SETTINGS_SECTIONS[nextIndex]?.id ?? SETTINGS_SECTIONS[0].id;
}
