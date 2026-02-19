import { Button } from "./ui/button";
import { useEditor } from "../contexts/EditorContext";
import { SettingsGeneralSection } from "./settings/SettingsGeneralSection";
import { SettingsAppearanceSection } from "./settings/SettingsAppearanceSection";
import { SettingsRecordingsSection } from "./settings/SettingsRecordingsSection";

export type ThemeMode = "light" | "dark";
export type NotesListMode = "separate" | "nested";

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "recordings";
type SettingsSection = {
  id: SettingsSectionId;
  title: string;
};

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "general",
    title: "Profiles",
  },
  { id: "appearance", title: "Appearance" },
  {
    id: "recordings",
    title: "Recordings",
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
      className={`item-row settings-row${isSelected ? " selected" : ""}`}
      variant="ghost"
      size="sm"
      onClick={onSelect}
    >
      <div className="settings-row-main">
        <div className="settings-row-title">{section.title}</div>
      </div>
    </Button>
  );
}

function SettingsDetail({ sectionId }: { sectionId: SettingsSectionId }) {
  if (sectionId === "general") return <SettingsGeneralSection />;
  if (sectionId === "appearance") return <SettingsAppearanceSection />;
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
        <nav className="settings-nav-list" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((section) => (
            <SettingsRow
              key={section.id}
              section={section}
              isSelected={activeSection === section.id}
              onSelect={() => onSectionChange(section.id)}
            />
          ))}
        </nav>
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
        <div className="settings-detail-shell">
          <SettingsDetail
            sectionId={activeSection as SettingsSectionId}
          />
        </div>
      </div>
    </div>
  );
}
