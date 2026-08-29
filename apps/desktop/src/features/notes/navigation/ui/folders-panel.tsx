// Folder navigation shell — renders the real folder tree through the same
// TreeNode/TreeRow/NavNoteRow stack Feed uses, so both share one visual and
// component base (hover/selected state, fonts, indentation, drag-and-drop).
import type { MouseEvent as ReactMouseEvent } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { TreeItem } from "../model/types";
import { TreeNode } from "./tree-node";
import type { NotePreview } from "@typenotes/shared/format";
import { ROOT_ID, dropId, type EdgeSnap } from "../model/tree-dnd";

const EMPTY_STRING_SET = new Set<string>();

type FoldersPanelProps = {
  treeData: TreeItem[];
  selectedIds: Set<string>;
  onSelect: (event: ReactMouseEvent, id: string) => void;
  edgeSnap: EdgeSnap;
  expanded: Set<string>;
  onToggle: (event: ReactMouseEvent, id: string) => void;
  onClearSelection: () => void;
  onPaneKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaneClick?: () => void;
  paneBodyRef?: React.Ref<HTMLDivElement>;
  renamingFolder: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  submitRenameFolder: () => void;
  cancelRenameFolder: () => void;
  onContextMenu: (event: ReactMouseEvent, id: string) => void;
  showNotesAsChildren?: boolean;
  selectedNoteIds?: Set<string>;
  onNoteSelect?: (notePath: string, event: ReactMouseEvent, parentPath: string) => void;
  onNoteContextMenu?: (
    event: ReactMouseEvent,
    notePath: string,
    parentPath: string
  ) => void;
  notePreviews?: Record<string, NotePreview>;
  indentationWidth: number;
};

export function FoldersPanel({
  treeData,
  selectedIds,
  onSelect,
  edgeSnap,
  expanded,
  onToggle,
  onClearSelection,
  onPaneKeyDown,
  onPaneClick,
  paneBodyRef,
  renamingFolder,
  renameValue,
  setRenameValue,
  submitRenameFolder,
  cancelRenameFolder,
  onContextMenu,
  showNotesAsChildren = false,
  selectedNoteIds = EMPTY_STRING_SET,
  onNoteSelect,
  onNoteContextMenu,
  notePreviews = {},
  indentationWidth,
}: FoldersPanelProps) {
  const { setNodeRef: setRootDropRef, isOver } = useDroppable({
    id: dropId(ROOT_ID, "inside"),
  });
  const handleNoteSelect =
    onNoteSelect ??
    (() => {
      return;
    });
  const handleNoteContextMenu =
    onNoteContextMenu ??
    (() => {
      return;
    });

  return (
    <div className="pane-section sidebar-folders-section">
      <div className="nav-scroll-area">
        <div
          ref={(node) => {
            setRootDropRef(node);
            if (typeof paneBodyRef === "function") {
              paneBodyRef(node);
            } else if (paneBodyRef && "current" in paneBodyRef) {
              paneBodyRef.current = node;
            }
          }}
          className={`pane-body tree-root focus:outline-none${isOver ? " drop-inside" : ""}`}
          tabIndex={0}
          onKeyDownCapture={onPaneKeyDown}
          onClick={(event) => {
            if (onPaneClick) {
              onPaneClick();
            }
            if (event.target === event.currentTarget) {
              onClearSelection();
            }
          }}
        >
          {treeData.length === 0 ? <div className="empty">No folders yet.</div> : null}
          {treeData.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              showNotesAsChildren={showNotesAsChildren}
              selectedNoteIds={selectedNoteIds}
              edgeSnap={edgeSnap}
              expanded={expanded}
              onToggle={onToggle}
              selectedIds={selectedIds}
              onSelect={onSelect}
              onNoteSelect={handleNoteSelect}
              onNoteContextMenu={handleNoteContextMenu}
              notePreviews={notePreviews}
              renamingFolder={renamingFolder}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              submitRenameFolder={submitRenameFolder}
              cancelRenameFolder={cancelRenameFolder}
              onContextMenu={onContextMenu}
              indentationWidth={indentationWidth}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
