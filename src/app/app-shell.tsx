import {
  useMemo,
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
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

import { useTheme } from "@/app/state/theme-context";
import { useNotesTree } from "@/features/notes/hooks/notes-tree-context";
import { useSelection } from "@/app/state/selection-context";
import { useEditor } from "@/features/editor/hooks/editor-context";
import { useRecordings } from "@/features/recording/hooks/recordings-context";
import { useHandwriting } from "@/features/handwriting/hooks/handwriting-context";
import { useSecurity } from "@/features/security/hooks/security-context";

import { useDragDrop } from "@/features/tree/hooks/use-drag-drop";
import { useKeyboardNavigation } from "@/features/tree/hooks/use-keyboard-navigation";
import { useTreeInteractions } from "@/app/hooks/use-tree-interactions";
import { useNoteOpener } from "@/app/hooks/use-note-opener";

import { FoldersPanel } from "@/features/tree/components/folders-panel";
import { type SettingsSectionId } from "@/features/settings/lib/sections";
import { AppSidebar } from "@/desktop/app-sidebar";
import { DesktopShell } from "@/desktop/desktop-shell";
import { DesktopMiddlePane } from "@/desktop/middle-pane";
import { DesktopRightPane } from "@/desktop/right-pane";
import { MobileShell } from "@/mobile/mobile-shell";
import { useLayoutMode } from "@/mobile/use-layout-mode";

import { focusNoScroll } from "@/shared/lib/dom";
import {
  ARCHIEVE_FOLDER_PATH,
  FEED_FOLDER_PATH,
  indentationWidth,
  isSystemFolder,
} from "@/shared/constants";
import type { AppMode } from "@/shared/types";

export function AppShell() {
  const layoutMode = useLayoutMode();

  // -- Contexts
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
  const { importHandwritingFile, handwritingImportBusy } = useHandwriting();
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

  // -- Local UI state
  const [appMode, setAppMode] = useState<AppMode>("notes");
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>("general");
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

  // -- Refs
  const notesPanelRef = useRef<HTMLDivElement | null>(null);
  const foldersPanelRef = useRef<HTMLDivElement | null>(null);
  const middlePaneRef = useRef<HTMLDivElement | null>(null);
  const handwritingInputRef = useRef<HTMLInputElement | null>(null);
  // Kept current so the delete-by-shortcut handler can read the live selection
  // without re-binding the keyboard hook on every selection change.
  const selectedNotesRef = useRef<Set<string>>(new Set());
  selectedNotesRef.current = selectedNotes;

  // -- Interaction handlers (clicks, toggle, native context menus) and
  //    programmatic navigation (sidebar Feed/Trash, the "open-note" event).
  const {
    handleFolderClick,
    handleToggle,
    handleNoteClick,
    handleFolderContextMenu,
    handleNoteContextMenu,
  } = useTreeInteractions({ foldersPanelRef });
  const { openPinnedFolder } = useNoteOpener({ setAppMode });

  // -- Drag-drop
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

  // -- Keyboard navigation
  const deleteSelectedNotesByShortcut = useCallback(() => {
    const selected = selectedNotesRef.current;
    // The active note acts as the anchor: when it sits outside the current
    // selection, delete just it; otherwise delete the whole selection.
    let paths: string[];
    if (activeNote && !selected.has(activeNote)) {
      paths = [activeNote];
    } else if (selected.size > 0) {
      paths = Array.from(selected);
    } else {
      paths = activeNote ? [activeNote] : [];
    }
    if (paths.length === 0) return;
    void deleteNotes(paths);
  }, [activeNote, deleteNotes]);

  const { handleNotesKeyDown, handleFoldersKeyDown, lastLeftPaneFocusRef } = useKeyboardNavigation({
    layoutMode,
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

  // -- Sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // -- Derived
  const appStyle = useMemo(
    () => ({ "--editor-font-size": `${editorFontSize}px` }) as CSSProperties,
    [editorFontSize]
  );

  const dndSensors = layoutMode === "desktop" ? sensors : [];
  const customFoldersTreeData = useMemo(
    () => treeData.filter((node) => !isSystemFolder(node.id)),
    [treeData]
  );

  const onHandwritingImportChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }
    void importHandwritingFile(file, activeFolder || undefined).catch((error) => {
      console.error("[handwriting] import failed", error);
    });
  };

  // -- Render helpers
  const renderLeftPane = () => (
    <div className="pane-with-drag">
      <div className="pane-drag-region" data-tauri-drag-region aria-hidden />
      <AppSidebar
        feedActive={appMode === "notes" && activeFolder === FEED_FOLDER_PATH}
        settingsActive={appMode === "settings"}
        trashActive={appMode === "notes" && activeFolder === ARCHIEVE_FOLDER_PATH}
        recordingActive={isRecordingAudio}
        recordingDisabled={!recordingSupported || isRecordingFinalizing}
        handwritingImportDisabled={handwritingImportBusy}
        onFeedClick={() => openPinnedFolder(FEED_FOLDER_PATH)}
        onNewNoteClick={() => void createNewNote()}
        onRecordingClick={() => {
          if (isRecordingAudio) {
            stopRecording();
          } else {
            void startRecording(activeFolder || undefined);
          }
        }}
        onHandwritingImportClick={() => handwritingInputRef.current?.click()}
        onSettingsClick={() => setAppMode("settings")}
        onTrashClick={() => openPinnedFolder(ARCHIEVE_FOLDER_PATH)}
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

  // -- Main render
  return (
    <DndContext
      sensors={dndSensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <input
        ref={handwritingInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={onHandwritingImportChange}
      />
      <div className={`window-shell theme-${theme}`}>
        {layoutMode === "desktop" ? (
          <DesktopShell
            theme={theme}
            appStyle={appStyle}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)}
            shouldNestNotesInNavigation={shouldNestNotesInNavigation}
            twoPaneLayout={twoPaneLayout}
            setTwoPaneLayout={setTwoPaneLayout}
            threePaneLayout={threePaneLayout}
            setThreePaneLayout={setThreePaneLayout}
            leftPane={renderLeftPane()}
            middlePane={
              <DesktopMiddlePane
                appMode={appMode}
                activeSettingsSection={activeSettingsSection}
                onSettingsSectionChange={setActiveSettingsSection}
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
        ) : (
          <MobileShell
            activeSettingsSection={activeSettingsSection}
            onSettingsSectionChange={setActiveSettingsSection}
            onNoteContextMenu={handleNoteContextMenu}
          />
        )}
      </div>
      <DragOverlay modifiers={[snapCenterToCursor]}>
        {layoutMode === "desktop" && activeId ? (
          <div className="drag-ghost">{activeId.split("/").pop() || activeId}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
