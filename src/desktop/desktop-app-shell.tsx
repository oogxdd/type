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

import { useTreeInteractions } from "@/app/hooks/use-tree-interactions";
import { useSelection } from "@/app/state/selection-context";
import { useTheme } from "@/app/state/theme-context";
import { useEditor } from "@/features/editor/hooks/editor-context";
import { useHandwriting } from "@/features/handwriting/hooks/handwriting-context";
import { useNotesTree } from "@/features/notes/hooks/notes-tree-context";
import { useRecordings } from "@/features/recording/hooks/recordings-context";
import { useSecurity } from "@/features/security/hooks/security-context";
import type { SettingsSectionId } from "@/features/settings/lib/sections";
import { FoldersPanel } from "@/features/tree/components/folders-panel";
import { useDragDrop } from "@/features/tree/hooks/use-drag-drop";
import { useKeyboardNavigation } from "@/features/tree/hooks/use-keyboard-navigation";
import {
  ARCHIEVE_FOLDER_PATH,
  FEED_FOLDER_PATH,
  indentationWidth,
  isSystemFolder,
} from "@/shared/constants";
import { focusNoScroll } from "@/shared/lib/dom";
import type { AppMode } from "@/shared/types";
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
  } = useTheme();
  const {
    recordingSupported,
    isRecordingAudio,
    isRecordingFinalizing,
    startRecording,
    stopRecording,
  } = useRecordings();
  const { handwritingImportBusy } = useHandwriting();
  const { lockSecurity } = useSecurity();
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
  } = useSelection();
  const { clearNote, rightPaneRef } = useEditor();
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
    allNotePreviews,
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
  const selectedNotesRef = useRef<Set<string>>(new Set());
  selectedNotesRef.current = selectedNotes;

  const {
    handleFolderClick,
    handleToggle,
    handleNoteClick,
    handleFolderContextMenu,
    handleNoteContextMenu,
  } = useTreeInteractions({ foldersPanelRef });
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

  const deleteSelectedNotesByShortcut = useCallback(() => {
    const selected = selectedNotesRef.current;
    const paths =
      activeNote && !selected.has(activeNote)
        ? [activeNote]
        : selected.size > 0
          ? Array.from(selected)
          : activeNote
            ? [activeNote]
            : [];
    if (paths.length > 0) {
      void deleteNotes(paths);
    }
  }, [activeNote, deleteNotes]);

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
      lockAppNow: () => lockSecurity(),
      setSidebarCollapsed,
      visibleItems,
      orderedIds,
      flatItemById,
      expanded,
      setExpanded,
      visibleNavigationItems,
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
      notes,
      activeNode,
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
  const customFoldersTreeData = useMemo(
    () => treeData.filter((node) => !isSystemFolder(node.id)),
    [treeData]
  );

  const leftPane = (
    <div className="pane-with-drag">
      <div className="pane-drag-region" data-tauri-drag-region aria-hidden />
      <AppSidebar
        feedActive={appMode === "notes" && activeFolder === FEED_FOLDER_PATH}
        settingsActive={appMode === "settings"}
        trashActive={appMode === "notes" && activeFolder === ARCHIEVE_FOLDER_PATH}
        recordingActive={isRecordingAudio}
        recordingDisabled={!recordingSupported || isRecordingFinalizing}
        handwritingImportDisabled={handwritingImportBusy}
        onFeedClick={() => onOpenPinnedFolder(FEED_FOLDER_PATH)}
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
        onTrashClick={() => onOpenPinnedFolder(ARCHIEVE_FOLDER_PATH)}
      >
        <FoldersPanel
          treeData={customFoldersTreeData}
          selectedIds={selectedFolders}
          onSelect={handleFolderClick}
          edgeSnap={edgeSnap}
          expanded={expanded}
          onToggle={handleToggle}
          showNotesAsChildren={shouldNestNotesInNavigation}
          selectedNoteIds={selectedNotes}
          onNoteSelect={handleNoteClick}
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
          showRecentTab={false}
          embedded
        />
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
        shouldNestNotesInNavigation={shouldNestNotesInNavigation}
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
            onNoteClick={handleNoteClick}
            onNoteContextMenu={handleNoteContextMenu}
          />
        }
        rightPane={
          <DesktopRightPane
            appMode={appMode}
            activeSettingsSection={activeSettingsSection}
          />
        }
      />
      <DragOverlay modifiers={[snapCenterToCursor]}>
        {activeId ? (
          <div className="drag-ghost">{activeId.split("/").pop() || activeId}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
