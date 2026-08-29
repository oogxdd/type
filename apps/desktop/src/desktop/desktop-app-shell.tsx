// Desktop shell composition stays outside the notes slice; it only wires the
// navigation panels into the current layout mode.
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type CSSProperties,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { useShallow } from "zustand/react/shallow";
import { ListFilter } from "lucide-react";

import { useTreeInteractions } from "@/app/hooks/use-tree-interactions";
import { useSelection } from "@/app/state/selection-store";
import { APP_EXTENSIONS } from "@/features/extensions/registry";
import {
  DESIGN_FONT_OPTIONS,
  useAppearance,
} from "@/app/state/appearance-store";
import { useHandwriting } from "@/features/handwriting/hooks/handwriting-context";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { useRecordings } from "@/features/recording/hooks/recordings-context";
import { useSecurity } from "@/features/security/hooks/security-context";
import type { SettingsSectionId } from "@/features/settings/lib/sections";
import { DesktopContextMenu } from "./desktop-context-menu";
import { useDesktopNavigation } from "./hooks/use-desktop-navigation";
import { FoldersPanel } from "@/features/notes/navigation/ui/folders-panel";
import { FeedPanel } from "@/features/notes/navigation/ui/feed-panel";
import { useDragDrop } from "@/features/notes/navigation/hooks/use-drag-drop";
import { useKeyboardNavigation } from "@/features/notes/navigation/hooks/use-keyboard-navigation";
import { ARCHIEVE_FOLDER_PATH } from "@typenotes/shared/constants";
import { indentationWidth } from "@/shared/constants";
import { focusNoScroll } from "@/shared/lib/dom";
import type { AppMode } from "@typenotes/shared/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import type { FeedNoteFilter } from "@/features/notes/navigation/model/feed-tree-model";
import { AppSidebar } from "./app-sidebar";
import { DesktopMiddlePane } from "./middle-pane";
import { DesktopRightPane } from "./right-pane";
import { DesktopShell } from "./desktop-shell";

type DesktopAppShellProps = {
  appMode: AppMode;
  onAppModeChange: Dispatch<SetStateAction<AppMode>>;
  activeSettingsSection: SettingsSectionId;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
  onImportHandwriting: () => void;
  onOpenPinnedFolder: (path: string) => void;
};

const FEED_FILTER_OPTIONS: Array<{ value: FeedNoteFilter; label: string }> = [
  { value: "all", label: "All notes" },
  { value: "active", label: "Active" },
  { value: "reviewed", label: "Reviewed" },
  { value: "unreviewed", label: "Unreviewed" },
  { value: "archived", label: "Archived" },
];

export function DesktopAppShell({
  appMode,
  onAppModeChange,
  activeSettingsSection,
  onSettingsSectionChange,
  onImportHandwriting,
  onOpenPinnedFolder,
}: DesktopAppShellProps) {
  const theme = useAppearance((state) => state.theme);
  const editorFontSize = useAppearance((state) => state.editorFontSize);
  const designFont = useAppearance((state) => state.designFont);
  const designPalettes = useAppearance((state) => state.designPalettes);
  const {
    recordingSupported,
    isRecordingAudio,
    isRecordingFinalizing,
    startRecording,
    stopRecording,
  } = useRecordings();
  const { handwritingImportBusy } = useHandwriting();
  const { lockSecurity } = useSecurity();
  const lockAppNow = useCallback(async () => {
    if (!APP_EXTENSIONS.security) {
      return;
    }
    await lockSecurity();
  }, [lockSecurity]);
  const {
    selectedFolders,
    activeFolder,
    selectedNotes,
    setSelectedFolders,
    setLastSelectedFolder,
    setSelectedNotes,
    setLastSelectedNote,
    setActiveNote,
  } = useSelection(
    useShallow((state) => ({
      selectedFolders: state.selectedFolders,
      activeFolder: state.activeFolder,
      selectedNotes: state.selectedNotes,
      setSelectedFolders: state.setSelectedFolders,
      setLastSelectedFolder: state.setLastSelectedFolder,
      setSelectedNotes: state.setSelectedNotes,
      setLastSelectedNote: state.setLastSelectedNote,
      setActiveNote: state.setActiveNote,
    }))
  );
  const {
    expanded,
    allNotePreviews,
    renamingFolder,
    renameValue,
    setRenameValue,
    submitRenameFolder,
    cancelRenameFolder,
    createNewNote,
    shouldNestNotesInNavigation,
    feedNoteFilter,
    setFeedNoteFilter,
  } = useNotesTree();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [feedFilterOpen, setFeedFilterOpen] = useState(false);
  const [threePaneLayout, setThreePaneLayout] = useState<Record<string, number>>({
    nav: 22,
    middle: 25,
    content: 53,
  });
  const [twoPaneLayout, setTwoPaneLayout] = useState<Record<string, number>>({
    nav: 29,
    content: 71,
  });

  const notesPanelRef = useRef<HTMLDivElement | null>(null);
  const foldersPanelRef = useRef<HTMLDivElement | null>(null);
  const middlePaneRef = useRef<HTMLDivElement | null>(null);

  const {
    handleFolderClick,
    handleToggle,
    handleNoteClick,
    handleFolderContextMenu,
    handleNoteContextMenu,
    desktopContextMenuState,
    openDesktopContextMenu,
    closeDesktopContextMenu,
  } = useTreeInteractions({ foldersPanelRef });
  const {
    activeNavigationTab,
    customFoldersTreeData,
    deleteSelectedNotesByShortcut,
    openFeedTab,
    openFoldersTab,
    middlePaneNotes,
    middlePaneNotePreviews,
    middlePaneTitle,
    middlePaneNoteClick,
    middlePaneNoteContextMenu,
  } = useDesktopNavigation({
    onAppModeChange,
    onOpenPinnedFolder,
    openDesktopContextMenu,
    closeDesktopContextMenu,
    handleNoteClick,
    handleNoteContextMenu,
  });
  const {
    activeId,
    edgeSnap,
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useDragDrop();

  const { handleNotesKeyDown, handleFoldersKeyDown, lastLeftPaneFocusRef } =
    useKeyboardNavigation({
      appMode,
      sidebarCollapsed,
      setSidebarCollapsed,
      deleteSelectedNotes: deleteSelectedNotesByShortcut,
      // The lock shortcut is optional. When security is disabled, keep the
      // command surface stable but make it a no-op.
      lockAppNow,
      activeNavigationTab,
      openFeedTab,
      openFoldersTab,
      notes: middlePaneNotes,
      foldersPanelRef,
      middlePaneRef,
      notesPanelRef,
    });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );
  const appStyle = useMemo(
    () => {
      const fontFamily =
        DESIGN_FONT_OPTIONS.find((option) => option.id === designFont)?.family ??
        DESIGN_FONT_OPTIONS[0].family;
      return {
        "--editor-font-size": `${editorFontSize}px`,
        "--design-font": fontFamily,
        "--design-light-bg": designPalettes.light.background,
        "--design-light-text": designPalettes.light.text,
        "--design-light-muted": designPalettes.light.muted,
        "--design-light-border": designPalettes.light.border,
        "--design-light-selection": designPalettes.light.selection,
        "--design-dark-bg": designPalettes.dark.background,
        "--design-dark-text": designPalettes.dark.text,
        "--design-dark-muted": designPalettes.dark.muted,
        "--design-dark-border": designPalettes.dark.border,
        "--design-dark-selection": designPalettes.dark.selection,
      } as CSSProperties;
    },
    [designFont, designPalettes, editorFontSize]
  );
  const leftPane = (
    <div className="pane-with-drag">
      <div className="pane-drag-region" data-tauri-drag-region aria-hidden />
      <AppSidebar
        settingsActive={appMode === "settings"}
        recordingActive={isRecordingAudio}
        recordingDisabled={!recordingSupported || isRecordingFinalizing}
        handwritingImportDisabled={handwritingImportBusy}
        onNewNoteClick={() => void createNewNote()}
        onRecordingClick={() => {
          if (isRecordingAudio) {
            stopRecording();
          } else {
            void startRecording(activeFolder || undefined);
          }
        }}
        onHandwritingImportClick={onImportHandwriting}
        onSettingsClick={() => onAppModeChange("settings")}
      >
        <Tabs
          value={activeNavigationTab}
          onValueChange={(value) => {
            if (value === "feed") {
              openFeedTab();
            } else {
              openFoldersTab();
            }
          }}
          className="h-full min-h-0 flex-1"
        >
          <div className="pane-section-title pane-tabs-wrap pane-tabs-header">
            <TabsList className="folders-tabs-list">
              <TabsTrigger value="feed" className="folders-tab-trigger">
                Feed
              </TabsTrigger>
              <TabsTrigger value="folders" className="folders-tab-trigger">
                Folders
              </TabsTrigger>
            </TabsList>
            <Popover open={feedFilterOpen} onOpenChange={setFeedFilterOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="feed-filter-trigger"
                  data-active={feedNoteFilter !== "all"}
                  aria-label="Filter Feed notes"
                  title="Filter Feed notes"
                >
                  <ListFilter aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={6}
                className="feed-filter-popover"
              >
                <div className="feed-filter-popover-title">Show</div>
                <div className="feed-filter-options" role="radiogroup" aria-label="Feed filter">
                  {FEED_FILTER_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={feedNoteFilter === option.value}
                      className="feed-filter-option"
                      data-selected={feedNoteFilter === option.value}
                      onClick={() => {
                        setFeedNoteFilter(option.value);
                        setFeedFilterOpen(false);
                      }}
                    >
                      <span>{option.label}</span>
                      <span className="feed-filter-option-mark" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <TabsContent value="feed" className="folders-tab-content min-h-0">
            <FeedPanel
              paneBodyRef={foldersPanelRef}
              onNavigateToNotes={() => onAppModeChange("notes")}
              onPaneKeyDown={handleFoldersKeyDown}
              onPaneClick={() => {
                lastLeftPaneFocusRef.current = "folders";
                focusNoScroll(foldersPanelRef.current);
              }}
              onOpenContextMenu={openDesktopContextMenu}
            />
          </TabsContent>
          <TabsContent value="folders" className="folders-tab-content min-h-0">
            <FoldersPanel
              treeData={customFoldersTreeData}
              selectedIds={selectedFolders}
              onSelect={(event, id) => {
                onAppModeChange("notes");
                handleFolderClick(event, id);
              }}
              edgeSnap={edgeSnap}
              expanded={expanded}
              onToggle={handleToggle}
              showNotesAsChildren={shouldNestNotesInNavigation}
              selectedNoteIds={selectedNotes}
              onNoteSelect={(notePath, event, parentPath) => {
                onAppModeChange("notes");
                handleNoteClick(notePath, event, parentPath);
              }}
              onNoteContextMenu={handleNoteContextMenu}
              notePreviews={allNotePreviews}
              onPaneKeyDown={handleFoldersKeyDown}
              onPaneClick={() => {
                lastLeftPaneFocusRef.current = "folders";
                focusNoScroll(foldersPanelRef.current);
              }}
              paneBodyRef={foldersPanelRef}
              onClearSelection={() => {
                setSelectedFolders(new Set());
                setLastSelectedFolder("");
                setSelectedNotes(new Set());
                setLastSelectedNote("");
                if (shouldNestNotesInNavigation) {
                  setActiveNote(null);
                }
              }}
              renamingFolder={renamingFolder}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              submitRenameFolder={submitRenameFolder}
              cancelRenameFolder={cancelRenameFolder}
              onContextMenu={handleFolderContextMenu}
              indentationWidth={indentationWidth}
            />
          </TabsContent>
        </Tabs>
      </AppSidebar>
    </div>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <DesktopShell
        theme={theme}
        appStyle={appStyle}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((previous) => !previous)}
        showMiddlePane={
          appMode === "settings" ||
          activeFolder === ARCHIEVE_FOLDER_PATH ||
          !shouldNestNotesInNavigation
        }
        twoPaneLayout={twoPaneLayout}
        setTwoPaneLayout={setTwoPaneLayout}
        threePaneLayout={threePaneLayout}
        setThreePaneLayout={setThreePaneLayout}
        leftPane={leftPane}
        middlePane={
          <DesktopMiddlePane
            appMode={appMode}
            activeSettingsSection={activeSettingsSection}
            onSettingsSectionChange={onSettingsSectionChange}
            notesPanelRef={notesPanelRef}
            middlePaneRef={middlePaneRef}
            lastLeftPaneFocusRef={lastLeftPaneFocusRef}
            onNotesKeyDown={handleNotesKeyDown}
            notesTitle={middlePaneTitle}
            notes={middlePaneNotes}
            notePreviews={middlePaneNotePreviews}
            selectedNotes={selectedNotes}
            onNoteClick={middlePaneNoteClick}
            onNoteContextMenu={middlePaneNoteContextMenu}
          />
        }
        rightPane={
          <DesktopRightPane
            appMode={appMode}
            activeSettingsSection={activeSettingsSection}
            onOpenTrash={() => onOpenPinnedFolder(ARCHIEVE_FOLDER_PATH)}
          />
        }
      />
      <DesktopContextMenu
        state={desktopContextMenuState}
        onClose={closeDesktopContextMenu}
      />
      <DragOverlay modifiers={[snapCenterToCursor]}>
        {activeId ? (
          <div className="drag-ghost">{activeId.split("/").pop() || activeId}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
