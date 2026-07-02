// Embedded-sidebar renderer for the same navigation tree shape as TreeNode.
import type { MouseEvent as ReactMouseEvent } from "react";
import { ChevronRight, File, Folder, Mic, PenLine } from "lucide-react";
import { Collapsible, CollapsibleContent } from "@/shared/ui/collapsible";
import {
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
} from "@/shared/ui/sidebar";
import type { NavigationNode } from "../model/types";
import type { NotePreview } from "@typenotes/shared/format";

type SidebarFileTreeNodeProps = {
  node: NavigationNode;
  selectedIds: Set<string>;
  selectedNoteIds: Set<string>;
  showNotesAsChildren: boolean;
  expanded: Set<string>;
  onSelect: (event: ReactMouseEvent, id: string) => void;
  onToggle: (event: ReactMouseEvent, id: string) => void;
  onNoteSelect: (notePath: string, event: ReactMouseEvent, parentPath: string) => void;
  onNoteContextMenu: (
    event: ReactMouseEvent,
    notePath: string,
    parentPath: string
  ) => void;
  notePreviews: Record<string, NotePreview>;
  renamingFolder?: string | null;
  renameValue?: string;
  setRenameValue?: (value: string) => void;
  submitRenameFolder?: () => void;
  cancelRenameFolder?: () => void;
  onContextMenu: (event: ReactMouseEvent, id: string) => void;
};

/**
 * The embedded-sidebar counterpart to {@link TreeNode}: renders the folder tree
 * (and, optionally, notes as children) using the shadcn Sidebar primitives and
 * without drag-and-drop. Used by FoldersPanel's `embedded` mode.
 */
export function SidebarFileTreeNode({
  node,
  selectedIds,
  selectedNoteIds,
  showNotesAsChildren,
  expanded,
  onSelect,
  onToggle,
  onNoteSelect,
  onNoteContextMenu,
  notePreviews,
  renamingFolder = null,
  renameValue = "",
  setRenameValue = () => {
    return;
  },
  submitRenameFolder = () => {
    return;
  },
  cancelRenameFolder = () => {
    return;
  },
  onContextMenu,
}: SidebarFileTreeNodeProps) {
  const notes = showNotesAsChildren ? node.notes || [] : [];
  const hasNestedItems = node.children.length > 0 || notes.length > 0;
  const isExpanded = !hasNestedItems || expanded.has(node.id);
  const isRenaming = renamingFolder === node.id;

  return (
    <SidebarMenuItem>
      <Collapsible open={isExpanded} className="group/collapsible">
        <SidebarMenuButton
          isActive={selectedIds.has(node.id)}
          className="sidebar-filetree-button"
          asChild
        >
          <div
            className="sidebar-filetree-button-inner"
            onClick={(event) => {
              onSelect(event, node.id);
            }}
            onContextMenu={(event) => {
              onContextMenu(event, node.id);
            }}
          >
            {hasNestedItems ? (
              <button
                type="button"
                className="sidebar-filetree-toggle"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle(event, node.id);
                }}
                aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
              >
                <ChevronRight
                  className={`sidebar-filetree-chevron${isExpanded ? " is-open" : ""}`}
                />
              </button>
            ) : (
              <span className="sidebar-filetree-toggle-spacer" aria-hidden />
            )}
            <Folder />
            {isRenaming ? (
              <input
                className="rename-input sidebar-filetree-rename-input"
                value={renameValue}
                autoFocus
                onChange={(event) => setRenameValue(event.target.value)}
                onBlur={submitRenameFolder}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") {
                    submitRenameFolder();
                  }
                  if (event.key === "Escape") {
                    cancelRenameFolder();
                  }
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              />
            ) : (
              <span>{node.name}</span>
            )}
          </div>
        </SidebarMenuButton>
        {!isRenaming && node.noteCount ? <SidebarMenuBadge>{node.noteCount}</SidebarMenuBadge> : null}
        {hasNestedItems ? (
          <CollapsibleContent>
            <SidebarMenuSub>
              {notes.map((note) => {
                const preview = notePreviews[note.path];
                return (
                  <SidebarMenuSubButton
                    key={note.path}
                    asChild
                    isActive={selectedNoteIds.has(note.path)}
                    size="md"
                  >
                    <button
                      type="button"
                      className="sidebar-filetree-note-button"
                      onClick={(event) => onNoteSelect(note.path, event, node.id)}
                      onContextMenu={(event) => onNoteContextMenu(event, note.path, node.id)}
                    >
                      <File />
                      <span>{preview?.title || note.name}</span>
                      {preview?.isRecording ? (
                        <Mic size={12} className="sidebar-filetree-note-mic" />
                      ) : preview?.isHandwriting ? (
                        <PenLine size={12} className="sidebar-filetree-note-mic" />
                      ) : null}
                    </button>
                  </SidebarMenuSubButton>
                );
              })}
              {node.children.map((child) => (
                <SidebarFileTreeNode
                  key={child.id}
                  node={child}
                  selectedIds={selectedIds}
                  selectedNoteIds={selectedNoteIds}
                  showNotesAsChildren={showNotesAsChildren}
                  expanded={expanded}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  onNoteSelect={onNoteSelect}
                  onNoteContextMenu={onNoteContextMenu}
                  notePreviews={notePreviews}
                  renamingFolder={renamingFolder}
                  renameValue={renameValue}
                  setRenameValue={setRenameValue}
                  submitRenameFolder={submitRenameFolder}
                  cancelRenameFolder={cancelRenameFolder}
                  onContextMenu={onContextMenu}
                />
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </SidebarMenuItem>
  );
}
