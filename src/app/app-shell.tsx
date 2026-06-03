import {
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
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
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu } from "@tauri-apps/api/menu";

import { useTheme } from "@/app/state/theme-context";
import { useNotesTree } from "@/contexts/notes-tree-context";
import { useSelection } from "@/app/state/selection-context";
import { useEditor } from "@/features/editor/hooks/editor-context";
import { useRecordings } from "@/contexts/recordings-context";
import { useHandwriting } from "@/contexts/handwriting-context";
import { useSecurity } from "@/contexts/security-context";

import { useDragDrop } from "@/features/tree/hooks/use-drag-drop";
import { useKeyboardNavigation } from "@/features/tree/hooks/use-keyboard-navigation";

import { FoldersPanel } from "@/features/tree/components/folders-panel";
import { type SettingsSectionId } from "@/features/settings/sections";
import { AppSidebar } from "@/desktop/app-sidebar";
import { DesktopShell } from "@/desktop/desktop-shell";
import { DesktopMiddlePane } from "@/desktop/middle-pane";
import { DesktopRightPane } from "@/desktop/right-pane";
import { MobileShell } from "@/mobile/mobile-shell";
import { useLayoutMode } from "@/mobile/use-layout-mode";

import { focusNoScroll } from "@/utils/dom";
import { getNoteParentPath } from "@/utils/notes";
import { computeRangeSelection, resolveTargetPaths } from "@/utils/selection";
import { findNode } from "@/features/tree/lib/tree-ops";
import {
  ARCHIEVE_FOLDER_PATH,
  FEED_FOLDER_PATH,
  indentationWidth,
  isSystemFolder,
} from "@/constants";
import type { AppMode } from "@/types";

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

  const {
    clearNote,
    rightPaneRef,
  } = useEditor();

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
    startRenameFolder,
    refreshTree,
    createNewNote,
    deleteNotes,
    deleteFolders,
    moveNotesToArchive,
    showNoteInfo,
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
  const folderContextPathRef = useRef<string | null>(null);
  const noteContextPathRef = useRef<string | null>(null);
  const handwritingInputRef = useRef<HTMLInputElement | null>(null);
  const selectedFoldersRef = useRef<Set<string>>(new Set());
  const selectedNotesRef = useRef<Set<string>>(new Set());
  const folderMenuPromiseRef = useRef<Promise<Menu> | null>(null);
  const noteMenuPromiseRef = useRef<Promise<Menu> | null>(null);

  // -- Sync refs
  selectedFoldersRef.current = selectedFolders;
  selectedNotesRef.current = selectedNotes;

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

  // -- Folder handlers
  const handleFolderClick = (event: ReactMouseEvent, path: string) => {
    event.stopPropagation();
    setSelectedFolders(
      computeRangeSelection(event, selectedFolders, orderedIds, lastSelectedFolder, path)
    );
    setLastSelectedFolder(path);
    setActiveFolder(path);
    setSelectedNotes(new Set());
    setLastSelectedNote("");
    setActiveNote(null);
    focusNoScroll(foldersPanelRef.current);
  };

  const handleToggle = (event: ReactMouseEvent, id: string) => {
    event.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // -- Folder context menu
  const getFolderNativeMenu = () => {
    if (!folderMenuPromiseRef.current) {
      folderMenuPromiseRef.current = Menu.new({
        items: [
          {
            id: "folder.rename",
            text: "Rename folder",
            action: () => {
              const path = folderContextPathRef.current;
              if (path) startRenameFolder(path);
            },
          },
          {
            id: "folder.delete",
            text: "Delete folder",
            action: () => {
              const path = folderContextPathRef.current;
              if (!path) return;
              void deleteFolders(resolveTargetPaths(selectedFoldersRef.current, path));
            },
          },
        ],
      });
    }
    return folderMenuPromiseRef.current;
  };

  const handleFolderContextMenu = async (event: ReactMouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedFolders.has(path)) {
      setSelectedFolders(new Set([path]));
      setLastSelectedFolder(path);
    }
    setActiveFolder(path);
    setSelectedNotes(new Set());
    setLastSelectedNote("");
    setActiveNote(null);
    focusNoScroll(foldersPanelRef.current);
    folderContextPathRef.current = path;
    const menu = await getFolderNativeMenu();
    await menu.popup(new LogicalPosition(event.clientX, event.clientY));
  };

  // -- Note handlers
  const handleNoteClick = (
    notePath: string,
    event: ReactMouseEvent,
    parentPath?: string
  ) => {
    const noteParentPath = parentPath ?? getNoteParentPath(notePath);
    const parentNode = findNode(tree, noteParentPath);
    if (!parentNode) return;
    const notePaths = parentNode.notes.map((n) => n.path);
    setSelectedNotes(
      computeRangeSelection(event, selectedNotes, notePaths, lastSelectedNote, notePath)
    );
    setLastSelectedNote(notePath);
    setSelectedFolders(new Set(noteParentPath ? [noteParentPath] : []));
    setLastSelectedFolder(noteParentPath);
    setActiveFolder(noteParentPath);
    setActiveNote(notePath);
    if (parentPath !== undefined || shouldNestNotesInNavigation) {
      focusNoScroll(foldersPanelRef.current);
    }
  };

  // -- Note context menu
  const getNoteNativeMenu = () => {
    if (!noteMenuPromiseRef.current) {
      noteMenuPromiseRef.current = Menu.new({
        items: [
          {
            id: "note.info",
            text: "See info",
            action: () => {
              const path = noteContextPathRef.current;
              if (path) void showNoteInfo(path);
            },
          },
          {
            id: "note.delete",
            text: "Delete selected",
            action: () => {
              const path = noteContextPathRef.current;
              if (!path) return;
              void deleteNotes(resolveTargetPaths(selectedNotesRef.current, path));
            },
          },
          {
            id: "note.move.archieve",
            text: "Move to Archive",
            action: () => {
              const path = noteContextPathRef.current;
              if (!path) return;
              void moveNotesToArchive(resolveTargetPaths(selectedNotesRef.current, path));
            },
          },
        ],
      });
    }
    return noteMenuPromiseRef.current;
  };

  const handleNoteContextMenu = async (
    event: ReactMouseEvent,
    path: string,
    parentPath?: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const noteParentPath = parentPath ?? getNoteParentPath(path);
    setSelectedFolders(new Set(noteParentPath ? [noteParentPath] : []));
    setLastSelectedFolder(noteParentPath);
    setActiveFolder(noteParentPath);
    if (!selectedNotes.has(path)) {
      setSelectedNotes(new Set([path]));
      setLastSelectedNote(path);
    }
    setActiveNote(path);
    if (parentPath !== undefined || shouldNestNotesInNavigation) {
      focusNoScroll(foldersPanelRef.current);
    }
    noteContextPathRef.current = path;
    const menu = await getNoteNativeMenu();
    await menu.popup(new LogicalPosition(event.clientX, event.clientY));
  };

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

  const openPinnedFolder = useCallback(
    (folderPath: string) => {
      setAppMode("notes");
      setSelectedFolders(new Set([folderPath]));
      setLastSelectedFolder(folderPath);
      setActiveFolder(folderPath);
      setSelectedNotes(new Set());
      setLastSelectedNote("");
      setActiveNote(null);
    },
    [
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
    ]
  );

  // Open a note by path, leaving settings/other modes if needed. Mirrors a
  // plain note click. Used by the Transcription settings page (via the
  // "open-note" window event) so a row can jump straight to its note.
  const openNoteByPath = useCallback(
    (notePath: string) => {
      const noteParentPath = getNoteParentPath(notePath);
      setAppMode("notes");
      setSelectedFolders(new Set(noteParentPath ? [noteParentPath] : []));
      setLastSelectedFolder(noteParentPath);
      setActiveFolder(noteParentPath);
      setSelectedNotes(new Set([notePath]));
      setLastSelectedNote(notePath);
      setActiveNote(notePath);
    },
    [
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
    ]
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const notePath = (event as CustomEvent<{ notePath?: string }>).detail
        ?.notePath;
      if (notePath) {
        openNoteByPath(notePath);
      }
    };
    window.addEventListener("open-note", handler);
    return () => window.removeEventListener("open-note", handler);
  }, [openNoteByPath]);

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
