import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";

import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { type DesktopContextMenuState } from "@/app/hooks/use-tree-interactions";
import { useSelection } from "@/app/state/selection-store";
import { FEED_FOLDER_PATH } from "@/shared/constants";
import { focusNoScroll } from "@/shared/lib/dom";
import { computeRangeSelection } from "@/shared/lib/selection";
import type { NotePreview } from "@/shared/lib/format";
import type { TreeItem } from "../model/types";
import { TreeNode } from "./tree-node";

type FeedPanelProps = {
  paneBodyRef: RefObject<HTMLDivElement | null>;
  onPaneClick?: () => void;
  onPaneKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onOpenContextMenu: (state: DesktopContextMenuState) => void;
};

export function FeedPanel({
  paneBodyRef,
  onPaneClick,
  onPaneKeyDown,
  onOpenContextMenu,
}: FeedPanelProps) {
  const { clearNote } = useEditor();
  const {
    feedTreeData,
    feedNodeById,
    activeFeedGroup,
    setActiveFeedGroup,
    expanded,
    setExpanded,
    allNotePreviews,
    shouldNestNotesInNavigation,
  } = useNotesTree();
  const {
    setSelectedFolders,
    setLastSelectedFolder,
    setActiveFolder,
    selectedNotes,
    setSelectedNotes,
    lastSelectedNote,
    setLastSelectedNote,
    setActiveNote,
  } = useSelection(
    useShallow((state) => ({
      setSelectedFolders: state.setSelectedFolders,
      setLastSelectedFolder: state.setLastSelectedFolder,
      setActiveFolder: state.setActiveFolder,
      selectedNotes: state.selectedNotes,
      setSelectedNotes: state.setSelectedNotes,
      lastSelectedNote: state.lastSelectedNote,
      setLastSelectedNote: state.setLastSelectedNote,
      setActiveNote: state.setActiveNote,
    }))
  );

  const selectFeedGroup = useCallback(
    (groupId: string) => {
      setActiveFeedGroup(groupId);
      setSelectedFolders(new Set([FEED_FOLDER_PATH]));
      setLastSelectedFolder(FEED_FOLDER_PATH);
      setActiveFolder(FEED_FOLDER_PATH);
      setSelectedNotes(new Set());
      setLastSelectedNote("");
      setActiveNote(null);
      clearNote();
      focusNoScroll(paneBodyRef.current);
    },
    [
      clearNote,
      paneBodyRef,
      setActiveFeedGroup,
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
    ]
  );

  const handleNoteSelect = useCallback(
    (notePath: string, event: ReactMouseEvent, parentPath: string) => {
      const parentNode = feedNodeById.get(parentPath);
      const notePaths = parentNode?.notes.map((note) => note.path) || [];
      setSelectedNotes(
        computeRangeSelection(event, selectedNotes, notePaths, lastSelectedNote, notePath)
      );
      setLastSelectedNote(notePath);
      setSelectedFolders(new Set([FEED_FOLDER_PATH]));
      setLastSelectedFolder(FEED_FOLDER_PATH);
      setActiveFolder(FEED_FOLDER_PATH);
      setActiveFeedGroup(parentPath);
      setActiveNote(notePath);
      if (shouldNestNotesInNavigation) {
        focusNoScroll(paneBodyRef.current);
      }
    },
    [
      feedNodeById,
      lastSelectedNote,
      paneBodyRef,
      selectedNotes,
      setActiveFeedGroup,
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
      shouldNestNotesInNavigation,
    ]
  );

  const handleToggle = useCallback(
    (event: ReactMouseEvent, id: string) => {
      event.stopPropagation();
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [setExpanded]
  );

  const handleNoteContextMenu = useCallback(
    (event: ReactMouseEvent, notePath: string, parentPath: string) => {
      event.preventDefault();
      event.stopPropagation();
      const parentNode = feedNodeById.get(parentPath);
      const notePaths = parentNode?.notes.map((note) => note.path) || [];
      const targetPaths =
        selectedNotes.size > 1 && selectedNotes.has(notePath) ? Array.from(selectedNotes) : [notePath];
      setSelectedFolders(new Set([FEED_FOLDER_PATH]));
      setLastSelectedFolder(FEED_FOLDER_PATH);
      setActiveFolder(FEED_FOLDER_PATH);
      if (!selectedNotes.has(notePath)) {
        setSelectedNotes(new Set([notePath]));
        setLastSelectedNote(notePath);
      }
      setActiveFeedGroup(parentPath);
      setActiveNote(notePath);
      focusNoScroll(paneBodyRef.current);
      onOpenContextMenu({
        kind: "note",
        x: event.clientX,
        y: event.clientY,
        path: notePath,
        parentPath,
        targetPaths: targetPaths.length > 0 ? targetPaths : notePaths,
      });
    },
    [
      feedNodeById,
      onOpenContextMenu,
      paneBodyRef,
      selectedNotes,
      setActiveFeedGroup,
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
    ]
  );

  if (feedTreeData.length === 0) {
    return <div className="empty">No feed notes yet.</div>;
  }

  return (
    <div
      className="nav-scroll-area"
      ref={paneBodyRef}
      tabIndex={0}
      onKeyDown={onPaneKeyDown}
      onClick={(event) => {
        if (onPaneClick) {
          onPaneClick();
        }
        if (event.target === event.currentTarget) {
          selectFeedGroup(activeFeedGroup || feedTreeData[0].id);
        }
      }}
    >
      <div className="pane-body tree-root">
        {feedTreeData.map((node) => (
          <TreeNode
            key={node.id}
            node={node as unknown as TreeItem}
            depth={0}
            selectedIds={activeFeedGroup ? new Set([activeFeedGroup]) : new Set()}
            selectedNoteIds={selectedNotes}
            showNotesAsChildren={shouldNestNotesInNavigation}
            edgeSnap={null}
            expanded={expanded}
            onSelect={(event, id) => {
              event.stopPropagation();
              selectFeedGroup(id);
            }}
            onToggle={handleToggle}
            onNoteSelect={handleNoteSelect}
            onNoteContextMenu={handleNoteContextMenu}
            notePreviews={allNotePreviews as Record<string, NotePreview>}
            renamingFolder={null}
            renameValue=""
            setRenameValue={() => {}}
            submitRenameFolder={() => {}}
            cancelRenameFolder={() => {}}
            onContextMenu={(event, id) => {
              event.preventDefault();
              event.stopPropagation();
              selectFeedGroup(id);
            }}
            indentationWidth={18}
            draggable={false}
            feedMode
            renamingEnabled={false}
          />
        ))}
      </div>
    </div>
  );
}
