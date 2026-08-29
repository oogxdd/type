import { APP_EXTENSIONS } from "@/features/extensions/registry";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import { cn } from "@/shared/lib/utils";
import {
  getAdjacentSettingsSectionId,
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
      data-settings-section={section.id}
      aria-current={isSelected ? "page" : undefined}
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
  const { rightPaneRef } = useEditor();

  const focusSectionRow = (sectionId: SettingsSectionId) => {
    requestAnimationFrame(() => {
      middlePaneRef.current
        ?.querySelector<HTMLElement>(`[data-settings-section="${sectionId}"]`)
        ?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="pane settings-nav-pane h-full min-h-0 min-w-0">
      <div className="pane-drag-region" data-tauri-drag-region aria-hidden />
      <div
        className="pane-body settings-nav-body"
        ref={middlePaneRef}
        tabIndex={0}
        onKeyDown={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.matches("input, textarea, select, [contenteditable='true']")) {
            return;
          }

          const key = event.key.toLowerCase();
          const isPlainKey = !event.metaKey && !event.ctrlKey && !event.altKey;
          const direction =
            event.key === "ArrowUp" || (isPlainKey && key === "k")
              ? -1
              : event.key === "ArrowDown" || (isPlainKey && key === "j")
                ? 1
                : null;

          if (direction) {
            event.preventDefault();
            const nextSection = getAdjacentSettingsSectionId(
              activeSection as SettingsSectionId,
              direction
            );
            onSectionChange(nextSection);
            focusSectionRow(nextSection);
            return;
          }

          if (
            isPlainKey &&
            (event.key === "Enter" || event.key === "ArrowRight" || key === "l")
          ) {
            event.preventDefault();
            rightPaneRef.current?.focus({ preventScroll: true });
          }
        }}
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
              onSelect={() => {
                onSectionChange(section.id);
                focusSectionRow(section.id);
              }}
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
