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
        "w-full border border-transparent rounded-lg px-2.5 py-2",
        "text-left text-[13px] font-semibold cursor-pointer",
        "transition-colors duration-150 ease-out",
        "text-foreground dark:text-[#dfe5ee]",
        "focus-visible:outline-none focus-visible:border-input/65 dark:focus-visible:border-[#59667a]",
        isSelected
          ? "bg-muted border-border/80 dark:bg-white/[0.1] dark:border-white/[0.14]"
          : "hover:bg-muted/60 dark:hover:bg-white/[0.06]",
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
  if (sectionId === "sync" && APP_EXTENSIONS.sync) return <SettingsSyncSection />;
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
    <div className="pane h-full min-h-0 min-w-0">
      <div className="pane-drag-region" data-tauri-drag-region aria-hidden />
      <div
        className="pane-body grid content-start gap-2 bg-[var(--ui-pane)] pt-[calc(8px+var(--left-panels-drag-height))] pb-2.5 px-2.5"
        ref={middlePaneRef}
        tabIndex={0}
        onClick={(event) => {
          if (shouldIgnorePaneFocusClick(event.target)) {
            return;
          }
          onPaneClick();
        }}
      >
        <nav className="grid gap-0.5" aria-label="Settings sections">
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
    <div className="pane h-full min-h-0 min-w-0 dark:backdrop-blur-none">
      <div
        className="pane-body bg-[var(--ui-pane)] pt-4 px-[18px] pb-[22px] max-[1320px]:pt-3.5 max-[1320px]:px-3.5 max-[1320px]:pb-[18px]"
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
