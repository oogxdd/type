import { APP_EXTENSIONS } from "@/features/extensions/registry";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import { cn } from "@/shared/lib/utils";
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
    <button
      type="button"
      className={cn(
        "settings-nav-row",
        isSelected && "is-selected",
      )}
      onClick={onSelect}
    >
      {section.title}
    </button>
  );
}

function SettingsDetail({
  sectionId,
  onOpenTrash,
}: {
  sectionId: SettingsSectionId;
  onOpenTrash: () => void;
}) {
  if (sectionId === "general") return <SettingsGeneralSection onOpenTrash={onOpenTrash} />;
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
    <div className="pane settings-nav-pane h-full min-h-0 min-w-0">
      <div className="pane-drag-region" data-tauri-drag-region aria-hidden />
      <div
        className="pane-body settings-nav-body"
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
  onOpenTrash,
  onPaneClick,
}: {
  activeSection: string;
  onOpenTrash: () => void;
  onPaneClick: () => void;
}) {
  const { rightPaneRef } = useEditor();

  return (
    <div className="pane settings-detail-pane h-full min-h-0 min-w-0 dark:backdrop-blur-none">
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
        <div className="mx-auto grid pb-1.5 max-w-[860px] max-[1320px]:max-w-full">
          <SettingsDetail
            sectionId={activeSection as SettingsSectionId}
            onOpenTrash={onOpenTrash}
          />
        </div>
      </div>
    </div>
  );
}
