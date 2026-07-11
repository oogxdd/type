// Feed navigation renders synthetic time buckets, not the folder tree.
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { useCallback } from "react";

import { clearDraft, clearNote } from "@/state/editor-store";
import {
  setActiveFeedGroup,
  setExpanded,
  useActiveFeedGroup,
  useFeedLoading,
  useFeedTree,
  useNotesStore,
  useShouldNestNotesInNavigation,
} from "@/state/notes-store";
import { type ContextMenuState } from "@/hooks/use-tree-interactions";
import {
  selectFolder,
  selectNote,
  setActiveFolder,
  setActiveNote,
  setLastSelectedFolder,
  setLastSelectedNote,
  setSelectedFolders,
  setSelectedNotes,
  useSelection,
} from "@/state/selection-store";
import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import { focusNoScroll } from "@/lib/dom";
import { computeRangeSelection } from "@/lib/selection";
import { TreeNode } from "./tree-node";

type FeedPanelProps = {
  paneBodyRef: RefObject<HTMLDivElement | null>;
  onNavigateToNotes?: () => void;
  onPaneClick?: () => void;
  onPaneKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onOpenContextMenu: (state: ContextMenuState) => void;
};

export function FeedPanel({
  paneBodyRef,
  onNavigateToNotes,
  onPaneClick,
  onPaneKeyDown,
  onOpenContextMenu,
}: FeedPanelProps) {
  const { treeData: feedTreeData, nodeById: feedNodeById } = useFeedTree();
  const activeFeedGroup = useActiveFeedGroup();
  const expanded = useNotesStore((state) => state.expanded);
  const allNotePreviews = useNotesStore((state) => state.previews);
  const feedLoading = useFeedLoading();
  const shouldNestNotesInNavigation = useShouldNestNotesInNavigation();
  const selectedNotes = useSelection((state) => state.selectedNotes);
  const lastSelectedNote = useSelection((state) => state.lastSelectedNote);

  const selectFeedGroup = useCallback(
    (groupId: string) => {
      onNavigateToNotes?.();
      setActiveFeedGroup(groupId);
      selectFolder(FEED_FOLDER_PATH);
      clearDraft();
      clearNote();
      focusNoScroll(paneBodyRef.current);
    },
    [onNavigateToNotes, paneBodyRef, selectFolder]
  );

  const handleNoteSelect = useCallback(
    (notePath: string, event: ReactMouseEvent, parentPath: string) => {
      onNavigateToNotes?.();
      const parentNode = feedNodeById.get(parentPath);
      const notePaths = parentNode?.notes.map((note) => note.path) || [];
      selectNote(
        notePath,
        FEED_FOLDER_PATH,
        computeRangeSelection(event, selectedNotes, notePaths, lastSelectedNote, notePath)
      );
      setActiveFeedGroup(parentPath);
      if (shouldNestNotesInNavigation) {
        focusNoScroll(paneBodyRef.current);
      }
    },
    [
      feedNodeById,
      lastSelectedNote,
      onNavigateToNotes,
      paneBodyRef,
      selectNote,
      selectedNotes,
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
    []
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
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
    ]
  );

  if (feedTreeData.length === 0) {
    return (
      <div className="empty">
        {feedLoading ? "Loading feed..." : "No feed notes yet."}
      </div>
    );
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
      <div className="pane-body tree-root feed-navigation-tree">
        {feedTreeData.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            selectedIds={activeFeedGroup ? new Set([activeFeedGroup]) : new Set()}
            selectedNoteIds={selectedNotes}
            showNotesAsChildren={shouldNestNotesInNavigation}
            edgeSnap={null}
            expanded={expanded}
            feedMode
            onSelect={(event, id) => {
              event.stopPropagation();
              selectFeedGroup(id);
            }}
            onToggle={handleToggle}
            onNoteSelect={handleNoteSelect}
            onNoteContextMenu={handleNoteContextMenu}
            notePreviews={allNotePreviews}
            onContextMenu={(event, id) => {
              event.preventDefault();
              event.stopPropagation();
              selectFeedGroup(id);
            }}
            indentationWidth={18}
            draggable={false}
          />
        ))}
      </div>
    </div>
  );
}
