import { Button } from "./ui/button";
import { useEditor } from "../contexts/EditorContext";
import { SettingsGeneralSection } from "./settings/SettingsGeneralSection";
import { SettingsAppearanceSection } from "./settings/SettingsAppearanceSection";
import { SettingsSyncSection } from "./settings/SettingsSyncSection";
import { SettingsRecordingsSection } from "./settings/SettingsRecordingsSection";

export type ThemeMode = "light" | "dark";
export type NotesListMode = "separate" | "nested";

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "sync"
  | "recordings";
type SettingsSection = {
  id: SettingsSectionId;
  title: string;
  description: string;
};

const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "general", title: "General", description: "Basic app behavior and defaults." },
  { id: "appearance", title: "Appearance", description: "Theme and visual style." },
  { id: "sync", title: "Sync", description: "Cloud sync, refresh policy, and conflict rules." },
  {
    id: "recordings",
    title: "Recordings",
    description: "Audio capture, transcription queue, and AssemblyAI settings.",
  },
];

function SettingsRow({
  section,
  isSelected,
  onSelect,
}: {
  section: SettingsSection;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      className={`item-row settings-row transition-colors${isSelected ? " selected" : ""}`}
      variant="ghost"
      size="sm"
      onClick={onSelect}
    >
      <div className="settings-row-main">
        <div className="settings-row-title">{section.title}</div>
        <div className="settings-row-subline">{section.description}</div>
      </div>
    </Button>
  );
}

function SettingsDetail({ sectionId }: { sectionId: SettingsSectionId }) {
  if (sectionId === "general") return <SettingsGeneralSection />;
  if (sectionId === "appearance") return <SettingsAppearanceSection />;
  if (sectionId === "sync") return <SettingsSyncSection />;
  if (sectionId === "recordings") return <SettingsRecordingsSection />;
  return null;
}

export function SettingsMiddlePane({
  activeSection,
  onSectionChange,
  middlePaneRef,
  onPaneClick,
}: {
  activeSection: string;
  onSectionChange: (id: SettingsSectionId) => void;
  middlePaneRef: React.RefObject<HTMLDivElement | null>;
  onPaneClick: () => void;
}) {
  return (
    <div className="pane settings-sections-pane min-w-0">
      <div className="pane-drag-region" data-tauri-drag-region aria-hidden />
      <div
        className="pane-body settings-sections-body"
        ref={middlePaneRef}
        tabIndex={0}
        onClick={onPaneClick}
      >
        {SETTINGS_SECTIONS.map((section) => (
          <SettingsRow
            key={section.id}
            section={section}
            isSelected={activeSection === section.id}
            onSelect={() => onSectionChange(section.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function SettingsDetailPane({
  activeSection,
  onPaneClick,
}: {
  activeSection: string;
  onPaneClick: () => void;
}) {
  const { rightPaneRef } = useEditor();

  return (
    <div className="pane settings-detail-pane min-w-0">
      <div
        className="pane-body settings-detail-body"
        ref={rightPaneRef}
        tabIndex={0}
        onClick={onPaneClick}
      >
        <SettingsDetail
          sectionId={activeSection as SettingsSectionId}
        />
      </div>
    </div>
  );
}
