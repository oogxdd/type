import { Archive, Folder, Settings } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { SettingsSectionId } from "@/features/settings/sections";
import { MobileEditorScreen } from "@/mobile/views/editor-view";
import { MobileFoldersScreen } from "@/mobile/views/folders-view";
import { MobileNotesScreen } from "@/mobile/views/notes-view";
import { MobileSettingsScreen } from "@/features/settings/mobile/settings-screen";
import { MobileNavBar } from "@/mobile/ui/nav-bar";
import { MobileTabBar } from "@/mobile/ui/tab-bar";
import { MOBILE_SETTINGS_SECTIONS } from "@/constants";
import { useTheme } from "@/app/state/theme-context";
import { useSelection } from "@/app/state/selection-context";
import { useEditor } from "@/features/editor/hooks/editor-context";
import { useNotesTree } from "@/features/notes/hooks/notes-tree-context";
import { useKeyboardInsets } from "@/mobile/use-keyboard-insets";
import { getDisplayRouteTitle, ARCHIVE_FOLDER_PATH } from "./types";

const TABLET_LEFT_ITEMS = [
  { id: "folders", label: "Folders", icon: <Folder size={16} /> },
  { id: "settings", label: "Settings", icon: <Settings size={16} /> },
] as const;

type TabletLayoutProps = {
  tabletLeftMode: "folders" | "settings";
  setTabletLeftMode: (mode: "folders" | "settings") => void;
  activeSettingsSection: SettingsSectionId;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
  showToast: (message: string, tone?: "info" | "success" | "error") => void;
  onNoteContextMenu: (
    event: ReactMouseEvent,
    notePath: string,
    parentPath?: string
  ) => Promise<void>;
  navigationFolders: import("@/features/tree/lib/types").FlattenedItem[];
  onToggleFolder: (path: string) => void;
  openFolderActionSheet: (path: string) => void;
  onDeleteNote: (path: string) => Promise<boolean>;
  onArchiveNote: (path: string) => Promise<void>;
  openNoteActionSheet: (path: string) => void;
  refreshNotesFeed: (folderPath: string) => Promise<void>;
};

export function TabletLayout({
  tabletLeftMode,
  setTabletLeftMode,
  activeSettingsSection,
  onSettingsSectionChange,
  showToast,
  onNoteContextMenu,
  navigationFolders,
  onToggleFolder,
  openFolderActionSheet,
  onDeleteNote,
  onArchiveNote,
  openNoteActionSheet,
  refreshNotesFeed,
}: TabletLayoutProps) {
  const { notesListMode } = useTheme();
  const { activeFolder, activeNote, selectFolderForMobile, selectNoteForMobile } =
    useSelection();
  const {
    noteContent,
    draftNoteContent,
    noteSaveError,
    handleEditorChange,
    retrySave,
  } = useEditor();
  const {
    notes,
    notePreviews,
    allNotePreviews,
    activeNode,
    expanded,
    createNewNote,
  } = useNotesTree();
  const { keyboardInset } = useKeyboardInsets();

  const activeFolderTitle = activeNode?.name || activeFolder || "Notes";
  const hasActiveNote = Boolean(activeNote);
  const editorMarkdown = activeNote ? noteContent : draftNoteContent;
  const activeNotePreview = activeNote
    ? notePreviews[activeNote] || allNotePreviews[activeNote]
    : undefined;

  const settingsScreen = (
    <MobileSettingsScreen
      activeSection={activeSettingsSection}
      onSectionChange={onSettingsSectionChange}
      sections={MOBILE_SETTINGS_SECTIONS}
    />
  );

  const tabletNotesPane = (
    <MobileNotesScreen
      folderTitle={activeFolderTitle}
      notes={notes}
      previews={notePreviews}
      activeNote={activeNote}
      onSelect={selectNoteForMobile}
      onCreate={() => {
        void (async () => {
          await createNewNote(activeFolder);
        })();
      }}
      onDelete={(path) => {
        void (async () => {
          try {
            const deleted = await onDeleteNote(path);
            if (deleted) {
              showToast("Note deleted", "success");
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showToast(message, "error");
          }
        })();
      }}
      onArchive={(path) => {
        void (async () => {
          try {
            await onArchiveNote(path);
            showToast("Moved to Archive", "success");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showToast(message, "error");
          }
        })();
      }}
      onLongPress={openNoteActionSheet}
      onContextMenu={(event, path) => {
        void onNoteContextMenu(event, path, activeFolder);
      }}
      onPullRefresh={async () => {
        await refreshNotesFeed(activeFolder);
      }}
      emptyStateText={`No notes in ${getDisplayRouteTitle(activeFolderTitle)}.`}
      createButtonLabel="Create note"
    />
  );

  const tabletFoldersPane =
    tabletLeftMode === "folders" ? (
      notesListMode === "nested" ? (
        <div className="mobile-tablet-left-content mobile-tablet-left-content-nested">
          <div className="mobile-tablet-left-folders">
            <div className="mobile-tablet-folders-nav">
              <div className="mobile-tablet-folders-list">
                <MobileFoldersScreen
                  items={navigationFolders}
                  activeFolder={activeFolder}
                  expanded={expanded}
                  onToggle={onToggleFolder}
                  onSelect={selectFolderForMobile}
                  onLongPress={openFolderActionSheet}
                />
              </div>
              <button
                type="button"
                className={`mobile-tablet-archive-btn${activeFolder === ARCHIVE_FOLDER_PATH ? " active" : ""}`}
                onClick={() => selectFolderForMobile(ARCHIVE_FOLDER_PATH)}
              >
                <Archive size={16} />
                <span>Archive</span>
              </button>
            </div>
          </div>
          <div className="mobile-tablet-left-notes">{tabletNotesPane}</div>
        </div>
      ) : (
        <div className="mobile-tablet-left-content">
          <div className="mobile-tablet-folders-nav">
            <div className="mobile-tablet-folders-list">
              <MobileFoldersScreen
                items={navigationFolders}
                activeFolder={activeFolder}
                expanded={expanded}
                onToggle={onToggleFolder}
                onSelect={selectFolderForMobile}
                onLongPress={openFolderActionSheet}
              />
            </div>
            <button
              type="button"
              className={`mobile-tablet-archive-btn${activeFolder === ARCHIVE_FOLDER_PATH ? " active" : ""}`}
              onClick={() => selectFolderForMobile(ARCHIVE_FOLDER_PATH)}
            >
              <Archive size={16} />
              <span>Archive</span>
            </button>
          </div>
        </div>
      )
    ) : (
      <div
        className="mobile-tablet-settings-sections"
        role="tablist"
        aria-label="Settings sections"
      >
        {MOBILE_SETTINGS_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`mobile-tablet-settings-btn${activeSettingsSection === section.id ? " active" : ""}`}
            onClick={() => onSettingsSectionChange(section.id)}
          >
            {section.label}
          </button>
        ))}
      </div>
    );

  const tabletRightContent =
    tabletLeftMode === "settings" ? (
      <div className="mobile-tablet-settings-content">{settingsScreen}</div>
    ) : notesListMode === "nested" ? (
      <div className="mobile-tablet-editor-only mobile-tablet-pane">
        <MobileEditorScreen
          markdown={editorMarkdown}
          onChange={handleEditorChange}
          notePath={activeNote}
          notePreview={activeNotePreview}
          hasActiveNote={hasActiveNote}
          saveError={noteSaveError}
          keyboardInset={keyboardInset}
          onRetrySave={() => {
            void retrySave();
          }}
        />
      </div>
    ) : (
      <div className="mobile-tablet-right-split mobile-tablet-right-split-notes">
        <div className="mobile-tablet-notes-pane mobile-tablet-pane">{tabletNotesPane}</div>
        <div className="mobile-tablet-editor-pane mobile-tablet-pane">
          <MobileEditorScreen
            markdown={editorMarkdown}
            onChange={handleEditorChange}
            notePath={activeNote}
            notePreview={activeNotePreview}
            hasActiveNote={hasActiveNote}
            saveError={noteSaveError}
            keyboardInset={keyboardInset}
            onRetrySave={() => {
              void retrySave();
            }}
          />
        </div>
      </div>
    );

  return (
    <div
      className={`mobile-tablet-shell mobile-tablet-shell-${tabletLeftMode} mobile-tablet-mode-${notesListMode}`}
    >
      <aside className="mobile-tablet-left">
        <MobileNavBar title="Navigation" />
        <MobileTabBar
          items={TABLET_LEFT_ITEMS.map((item) => ({
            id: item.id,
            label: item.label,
            icon: item.icon,
          }))}
          activeId={tabletLeftMode}
          onSelect={(id) => {
            if (id === "folders" || id === "settings") {
              setTabletLeftMode(id);
            }
          }}
        />
        {tabletFoldersPane}
      </aside>
      <section
        className={`mobile-tablet-right mobile-tablet-right-${tabletLeftMode} mobile-tablet-right-mode-${notesListMode}`}
      >
        {tabletRightContent}
      </section>
    </div>
  );
}
