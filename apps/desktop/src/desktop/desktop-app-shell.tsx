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

import { useTreeInteractions } from "@/app/hooks/use-tree-interactions";
import { useSelection } from "@/app/state/selection-store";
import { APP_EXTENSIONS } from "@/features/extensions/registry";
import { useAppearance } from "@/app/state/appearance-store";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
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
import { ARCHIEVE_FOLDER_PATH, isSystemFolder } from "@typenotes/shared/constants";
import { indentationWidth } from "@/shared/constants";
import { focusNoScroll } from "@/shared/lib/dom";
import type { AppMode } from "@typenotes/shared/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
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

export function DesktopAppShell({
  appMode,
  onAppModeChange,
  activeSettingsSection,
  onSettingsSectionChange,
  onImportHandwriting,
  onOpenPinnedFolder,
}: DesktopAppShellProps) {
  const {
    theme,
    editorFontSize,
    increaseEditorFontSize,
    decreaseEditorFontSize,
    resetEditorFontSize,
  } = useAppearance(
    useShallow((state) => ({
      theme: state.theme,
      editorFontSize: state.editorFontSize,
      increaseEditorFontSize: state.increaseEditorFontSize,
      decreaseEditorFontSize: state.decreaseEditorFontSize,
      resetEditorFontSize: state.resetEditorFontSize,
    }))
  );
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
    setSelectedFolders,
    lastSelectedFolder,
    setLastSelectedFolder,
    activeFolder,
    setActiveFolder,
    selectedNotes,
    setSelectedNotes,
    lastSelectedNote,
    setLastSelectedNote,
    activeNote,
    setActiveNote,
  } = useSelection(
    useShallow((state) => ({
      selectedFolders: state.selectedFolders,
      setSelectedFolders: state.setSelectedFolders,
      lastSelectedFolder: state.lastSelectedFolder,
      setLastSelectedFolder: state.setLastSelectedFolder,
      activeFolder: state.activeFolder,
      setActiveFolder: state.setActiveFolder,
      selectedNotes: state.selectedNotes,
      setSelectedNotes: state.setSelectedNotes,
      lastSelectedNote: state.lastSelectedNote,
      setLastSelectedNote: state.setLastSelectedNote,
      activeNote: state.activeNote,
      setActiveNote: state.setActiveNote,
    }))
  );
  const { clearDraft, clearNote, rightPaneRef } = useEditor();
  const {
    tree,
    setTree,
    treeData,
    flatItems,
    visibleItems,
    orderedIds,
    flatItemById,
    expanded,
    setExpanded,
    notes,
    notePreviews,
    allNotePreviews,
    feedNodeById,
    activeFeedGroup,
    setActiveFeedGroup,
    activeFeedNode,
    feedNotes,
    feedNotePreviews,
    feedVisibleNavigationItems,
    activeNode,
    visibleNavigationItems,
    parentById,
    renamingFolder,
    renameValue,
    setRenameValue,
    submitRenameFolder,
    cancelRenameFolder,
    refreshTree,
    createNewNote,
    deleteNotes,
    shouldNestNotesInNavigation,
  } = useNotesTree();
  const customFoldersTreeData = useMemo(
    () => treeData.filter((node) => !isSystemFolder(node.id)),
    [treeData]
  );

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
    customFoldersTreeData,
    activeFolder,
    activeNote,
    activeFeedGroup,
    activeFeedNode,
    feedNotes,
    selectedNotes,
    lastSelectedNote,
    setSelectedFolders,
    setLastSelectedFolder,
    setActiveFolder,
    setSelectedNotes,
    setLastSelectedNote,
    setActiveNote,
    setActiveFeedGroup,
    clearNote,
    openDesktopContextMenu,
    closeDesktopContextMenu,
    handleNoteClick,
    handleNoteContextMenu,
    notes,
    notePreviews,
    activeNode,
    feedNotePreviews,
    deleteNotes,
  });
  const {
    activeId,
    edgeSnap,
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useDragDrop({
    tree,
    setTree,
    treeData,
    flatItems,
    orderedIds,
    expanded,
    setExpanded,
    selectedFolders,
    setSelectedFolders,
    setLastSelectedFolder,
    selectedNotes,
    setSelectedNotes,
    setLastSelectedNote,
    setActiveNote,
    activeNote,
    clearNote,
    refreshTree,
    parentById,
  });

  const { handleNotesKeyDown, handleFoldersKeyDown, lastLeftPaneFocusRef } =
    useKeyboardNavigation({
      layoutMode: "desktop",
      appMode,
      shouldNestNotesInNavigation,
      sidebarCollapsed,
      increaseEditorFontSize,
      decreaseEditorFontSize,
      resetEditorFontSize,
      createNewNote: () => createNewNote(),
      deleteSelectedNotes: deleteSelectedNotesByShortcut,
      // The lock shortcut is optional. When security is disabled, keep the
      // command surface stable but make it a no-op.
      lockAppNow,
      setSidebarCollapsed,
      visibleItems,
      orderedIds,
      flatItemById,
      expanded,
      setExpanded,
      visibleNavigationItems,
      activeNavigationTab,
      feedVisibleNavigationItems,
      feedNodeById,
      activeFolder,
      lastSelectedFolder,
      setSelectedFolders,
      setLastSelectedFolder,
      setActiveFolder,
      activeNote,
      lastSelectedNote,
      setSelectedNotes,
      setLastSelectedNote,
      setActiveNote,
      notes: middlePaneNotes,
      activeFeedGroup,
      setActiveFeedGroup,
      foldersPanelRef,
      middlePaneRef,
      rightPaneRef,
      notesPanelRef,
    });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );
  const appStyle = useMemo(
    () => ({ "--editor-font-size": `${editorFontSize}px` }) as CSSProperties,
    [editorFontSize]
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
          <div className="pane-section-title pane-tabs-wrap">
            <TabsList className="folders-tabs-list">
              <TabsTrigger value="feed" className="folders-tab-trigger">
                Feed
              </TabsTrigger>
              <TabsTrigger value="folders" className="folders-tab-trigger">
                Folders
              </TabsTrigger>
            </TabsList>
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
                clearDraft();
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
