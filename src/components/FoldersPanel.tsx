import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ChevronRight, File, Folder, Mic, PenLine } from "lucide-react";
import type { TreeItem } from "../tree/types";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import {
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
} from "./ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { TreeNode } from "./TreeNode";
import { RecentTreeNode } from "./RecentTreeNode";
import type { RecentNode } from "./RecentTreeNode";
import type { NotePreview } from "../utils/format";

const DROP_PREFIX = "drop";
const ROOT_ID = "root";
const EMPTY_STRING_SET = new Set<string>();

const dropId = (id: string, position: "inside") => `${DROP_PREFIX}:${id}:${position}`;

export type EdgeSnap = { id: string; position: "before" | "after" } | null;

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
  showRecentTab?: boolean;
  embedded?: boolean;
};

const RECENT_PRIMARY_NODES: RecentNode[] = [
  { id: "recent:today", name: "Today" },
  { id: "recent:yesterday", name: "Yesterday" },
  { id: "recent:monday", name: "Monday" },
];

const RECENT_EXPANDED_NODES: RecentNode[] = [
  {
    id: "recent:2025",
    name: "2025",
    children: [
      {
        id: "recent:2025:q1",
        name: "Q1",
        children: [
          {
            id: "recent:2025:q1:january",
            name: "January",
            children: [
              {
                id: "recent:2025:q1:january:w1",
                name: "Week 1 (1-7 Jan)",
                children: [{ id: "recent:2025:q1:january:w1:monday", name: "Monday" }],
              },
              {
                id: "recent:2025:q1:january:w2",
                name: "Week 2 (8-14 Jan)",
                children: [{ id: "recent:2025:q1:january:w2:tuesday", name: "Tuesday" }],
              },
            ],
          },
        ],
      },
    ],
  },
];

type SidebarFileTreeNodeProps = {
  node: TreeItem;
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
  renamingFolder: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  submitRenameFolder: () => void;
  cancelRenameFolder: () => void;
  onContextMenu: (event: ReactMouseEvent, id: string) => void;
};

function SidebarFileTreeNode({
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
  renamingFolder,
  renameValue,
  setRenameValue,
  submitRenameFolder,
  cancelRenameFolder,
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
  showRecentTab = true,
  embedded = false,
}: FoldersPanelProps) {
  const [activeTab, setActiveTab] = useState<"recent" | "folders">(
    showNotesAsChildren || !showRecentTab ? "folders" : "recent"
  );
  const [showMoreRecent, setShowMoreRecent] = useState(false);
  const [expandedRecent, setExpandedRecent] = useState<Set<string>>(
    new Set([
      "recent:2025",
      "recent:2025:q1",
      "recent:2025:q1:january",
      "recent:2025:q1:january:w1",
      "recent:2025:q1:january:w2",
    ])
  );
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

  useEffect(() => {
    if (showNotesAsChildren || !showRecentTab) {
      setActiveTab("folders");
    }
  }, [showNotesAsChildren, showRecentTab]);

  const toggleRecentNode = (id: string) => {
    setExpandedRecent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const sectionContent = (
    <div className={embedded ? "pane-section sidebar-folders-section" : "pane-section"}>
      {showRecentTab ? (
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "recent" | "folders")}
          className="folders-tabs"
        >
          <div className="pane-section-title pane-tabs-wrap">
            <TabsList className="folders-tabs-list">
              <TabsTrigger value="recent" className="folders-tab-trigger">
                Recent
              </TabsTrigger>
              <TabsTrigger value="folders" className="folders-tab-trigger">
                {sectionTitle ?? "Folders"}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="folders" className="folders-tab-content">
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
          </TabsContent>
          <TabsContent value="recent" className="folders-tab-content">
            <div className="nav-scroll-area">
              <div className="pane-body tree-root recent-pane-body">
                {RECENT_PRIMARY_NODES.map((node) => (
                  <RecentTreeNode
                    key={node.id}
                    node={node}
                    depth={0}
                    expanded={expandedRecent}
                    onToggle={toggleRecentNode}
                    indentationWidth={indentationWidth}
                  />
                ))}
                <button
                  type="button"
                  className="recent-show-more"
                  onClick={() => setShowMoreRecent((prev) => !prev)}
                >
                  {showMoreRecent ? "Show less" : "Show more"}
                </button>
                {showMoreRecent
                  ? RECENT_EXPANDED_NODES.map((node) => (
                      <RecentTreeNode
                        key={node.id}
                        node={node}
                        depth={0}
                        expanded={expandedRecent}
                        onToggle={toggleRecentNode}
                        indentationWidth={indentationWidth}
                      />
                    ))
                  : null}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      ) : (
        <>
          {sectionTitle ? <div className="pane-section-title">{sectionTitle}</div> : null}
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
              {embedded ? (
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
                </>
              )}
            </div>
          </div>
        </>
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

export { DROP_PREFIX, ROOT_ID, dropId };
