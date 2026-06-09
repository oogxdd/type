// Folder navigation shell for the desktop sidebar and embedded sidebar mode.
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { TreeItem } from "../model/types";
import { SidebarMenu } from "@/shared/ui/sidebar";
import { TreeNode } from "./tree-node";
import { SidebarFileTreeNode } from "./sidebar-file-tree-node";
import type { NotePreview } from "@/shared/lib/format";
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
  topAction?: React.ReactNode;
  sectionTitle?: string;
  footer?: React.ReactNode;
  embedded?: boolean;
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
  topAction,
  sectionTitle,
  footer,
  embedded = false,
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

  // The folder tree is rendered in two layouts here: the embedded sidebar and
  // the plain pane. They share the same drop-target root and row mapping.
  const renderTreeNodes = () =>
    treeData.map((node) => (
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
    ));

  const renderDroppablePaneBody = (children: ReactNode) => (
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
        className={`pane-body tree-root${isOver ? " drop-inside" : ""}`}
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
        {children}
      </div>
    </div>
  );

  const sectionContent = (
    <div className={embedded ? "pane-section sidebar-folders-section" : "pane-section"}>
      {sectionTitle ? <div className="pane-section-title">{sectionTitle}</div> : null}
      {renderDroppablePaneBody(
        embedded ? (
          <SidebarMenu className="sidebar-filetree-menu">
            {treeData.length === 0 ? <div className="empty">No folders yet.</div> : null}
            {treeData.map((node) => (
              <SidebarFileTreeNode
                key={node.id}
                node={node}
                selectedIds={selectedIds}
                selectedNoteIds={selectedNoteIds}
                showNotesAsChildren={showNotesAsChildren}
                expanded={expanded}
                onSelect={onSelect}
                onToggle={onToggle}
                onNoteSelect={handleNoteSelect}
                onNoteContextMenu={handleNoteContextMenu}
                notePreviews={notePreviews}
                renamingFolder={renamingFolder}
                renameValue={renameValue}
                setRenameValue={setRenameValue}
                submitRenameFolder={submitRenameFolder}
                cancelRenameFolder={cancelRenameFolder}
                onContextMenu={onContextMenu}
              />
            ))}
          </SidebarMenu>
        ) : (
          <>
            {treeData.length === 0 ? <div className="empty">No folders yet.</div> : null}
            {renderTreeNodes()}
          </>
        )
      )}
    </div>
  );

  if (embedded) {
    return sectionContent;
  }

  return (
    <div className="pane tree-pane nav-pane">
      {topAction ? (
        <div className="pane-top pane-top-draggable">
          <div className="pane-top-drag-region" data-tauri-drag-region aria-hidden />
          <div className="pane-top-content">{topAction}</div>
        </div>
      ) : null}
      {sectionContent}
      {footer ? <div className="pane-footer">{footer}</div> : null}
    </div>
  );
}
