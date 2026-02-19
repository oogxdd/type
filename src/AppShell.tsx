import {
  useMemo,
  useRef,
  useState,
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
import { Settings } from "lucide-react";

import { useTheme } from "./contexts/ThemeContext";
import { useNotesTree } from "./contexts/NotesTreeContext";
import { useSelection } from "./contexts/SelectionContext";
import { useEditor } from "./contexts/EditorContext";
import { useRecordings } from "./contexts/RecordingsContext";

import { useDragDrop } from "./hooks/useDragDrop";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";

import { FoldersPanel } from "./components/FoldersPanel";
import { type SettingsSectionId } from "./components/SettingsPanel";
import { DesktopShell } from "./desktop/DesktopShell";
import { DesktopMiddlePane } from "./desktop/DesktopMiddlePane";
import { DesktopRightPane } from "./desktop/DesktopRightPane";
import { MobileShell } from "./mobile/MobileShell";
import { useLayoutMode } from "./mobile/useLayoutMode";

import { focusNoScroll } from "./utils/dom";
import { getNoteParentPath } from "./utils/notes";
import { indentationWidth } from "./constants";
import type { AppMode } from "./types";

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
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>("profile");
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
  const { handleNotesKeyDown, handleFoldersKeyDown, lastLeftPaneFocusRef } = useKeyboardNavigation({
    layoutMode,
    appMode,
    shouldNestNotesInNavigation,
    sidebarCollapsed,
    editorFontSize,
    increaseEditorFontSize,
    decreaseEditorFontSize,
    resetEditorFontSize,
    createNewNote: () => createNewNote(),
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
    const nextSelected = new Set(selectedFolders);
    if (event.shiftKey && lastSelectedFolder) {
      const visibleFolders = orderedIds;
      const start = visibleFolders.indexOf(lastSelectedFolder);
      const end = visibleFolders.indexOf(path);
      if (start !== -1 && end !== -1) {
        const [from, to] = start < end ? [start, end] : [end, start];
        nextSelected.clear();
        visibleFolders.slice(from, to + 1).forEach((p) => nextSelected.add(p));
      } else {
        nextSelected.clear();
        nextSelected.add(path);
      }
    } else if (event.metaKey || event.ctrlKey) {
      if (nextSelected.has(path)) nextSelected.delete(path);
      else nextSelected.add(path);
    } else {
      nextSelected.clear();
      nextSelected.add(path);
    }
    setSelectedFolders(nextSelected);
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
              const selected = selectedFoldersRef.current;
              const paths =
                selected.size > 1 && selected.has(path)
                  ? Array.from(selected)
                  : [path];
              void deleteFolders(paths);
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
    const parentNode = tree ? findNodeInTree(tree, noteParentPath) : null;
    if (!parentNode) return;
    const notePaths = parentNode.notes.map((n) => n.path);
    const nextSelected = new Set(selectedNotes);
    if (event.shiftKey && lastSelectedNote) {
      const start = notePaths.indexOf(lastSelectedNote);
      const end = notePaths.indexOf(notePath);
      if (start !== -1 && end !== -1) {
        const [from, to] = start < end ? [start, end] : [end, start];
        nextSelected.clear();
        notePaths.slice(from, to + 1).forEach((p) => nextSelected.add(p));
      } else {
        nextSelected.clear();
        nextSelected.add(notePath);
      }
    } else if (event.metaKey || event.ctrlKey) {
      if (nextSelected.has(notePath)) nextSelected.delete(notePath);
      else nextSelected.add(notePath);
    } else {
      nextSelected.clear();
      nextSelected.add(notePath);
    }
    setSelectedNotes(nextSelected);
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
              const selected = selectedNotesRef.current;
              const paths =
                selected.size > 1 && selected.has(path)
                  ? Array.from(selected)
                  : [path];
              void deleteNotes(paths);
            },
          },
          {
            id: "note.move.archieve",
            text: "Move to Archive",
            action: () => {
              const path = noteContextPathRef.current;
              if (!path) return;
              const selected = selectedNotesRef.current;
              const paths =
                selected.size > 1 && selected.has(path)
                  ? Array.from(selected)
                  : [path];
              void moveNotesToArchive(paths);
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

  // -- Render helpers
  const renderLeftPane = () => (
    <div className="pane-with-drag">
      <div className="pane-drag-region" data-tauri-drag-region aria-hidden />
      <FoldersPanel
        treeData={treeData}
        selectedIds={selectedFolders}
        onSelect={handleFolderClick}
        edgeSnap={edgeSnap}
        expanded={expanded}
        onToggle={handleToggle}
        showNotesAsChildren={shouldNestNotesInNavigation}
        selectedNoteIds={selectedNotes}
        onNoteSelect={handleNoteClick}
        onNoteContextMenu={handleNoteContextMenu}
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
        sectionTitle="Folders"
        topAction={
          <div className="nav-action-group">
            <button
              type="button"
              className="nav-action nav-action-new rounded-xl px-3 py-2 transition-colors"
              onClick={(event) => {
                event.stopPropagation();
                void createNewNote();
              }}
            >
              <span className="nav-action-icon" aria-hidden>
                +
              </span>
              <span>New note</span>
            </button>
            <button
              type="button"
              className={`nav-action nav-action-record rounded-xl px-3 py-2 transition-colors${
                isRecordingAudio ? " active" : ""
              }`}
              onClick={(event) => {
                event.stopPropagation();
                if (isRecordingAudio) {
                  stopRecording();
                } else {
                  void startRecording(activeFolder || undefined);
                }
              }}
              disabled={!recordingSupported || isRecordingFinalizing}
            >
              <span className="nav-action-icon" aria-hidden>
                {isRecordingAudio ? "■" : "●"}
              </span>
              <span>{isRecordingAudio ? "Stop recording" : "Record audio"}</span>
            </button>
          </div>
        }
        footer={
          <button
            type="button"
            className={`nav-action nav-action-settings rounded-xl px-3 py-2 transition-colors${
              appMode === "settings" ? " active" : ""
            }`}
            onClick={(event) => {
              event.stopPropagation();
              setAppMode((prev) => (prev === "notes" ? "settings" : "notes"));
            }}
          >
            <span className="nav-action-icon text-base leading-none" aria-hidden>
              {appMode === "settings" ? (
                "←"
              ) : (
                <Settings className="h-4 w-4 shrink-0" strokeWidth={1.9} />
              )}
            </span>
            <span>{appMode === "settings" ? "Back to notes" : "Settings"}</span>
          </button>
        }
      />
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

// Helper needed for note click handler
function findNodeInTree(node: import("./types").FolderNode, path: string): import("./types").FolderNode | null {
  if (node.path === path) return node;
  for (const child of node.children) {
    const found = findNodeInTree(child, path);
    if (found) return found;
  }
  return null;
}
