import { Button } from "@/shared/ui/button";
import { APP_EXTENSIONS } from "@/features/extensions/registry";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
  type SettingsSectionId,
} from "../../lib/sections";
import { SettingsGeneralSection } from "./general-section";
import { SettingsProfileSection } from "./profile-section";
import { SettingsImportSection } from "./import-section";
import { SettingsSyncSection } from "./sync-section";
import { SettingsAppearanceSection } from "./appearance-section";
import { SettingsRecordingsSection } from "./recordings-section";
import { SettingsTranscriptionSection } from "./transcription-section";
import { SettingsUpdatesSection } from "./updates-section";
import { SettingsSecuritySection } from "./security-section";

const shouldIgnorePaneFocusClick = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest("input, textarea, select, button, a, label, [contenteditable='true']")
  );
};

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
  if (sectionId === "profile") return <SettingsProfileSection />;
  if (sectionId === "import") return <SettingsImportSection />;
  if (sectionId === "sync") return <SettingsSyncSection />;
  if (sectionId === "updates") return <SettingsUpdatesSection />;
  if (sectionId === "appearance") return <SettingsAppearanceSection />;
  if (sectionId === "transcription") return <SettingsTranscriptionSection />;
  if (sectionId === "recordings") return <SettingsRecordingsSection />;
  if (sectionId === "security" && APP_EXTENSIONS.security) return <SettingsSecuritySection />;
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
        onClick={(event) => {
          if (shouldIgnorePaneFocusClick(event.target)) {
            return;
          }
          onPaneClick();
        }}
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
        onClick={(event) => {
          if (shouldIgnorePaneFocusClick(event.target)) {
            return;
          }
          onPaneClick();
        }}
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
