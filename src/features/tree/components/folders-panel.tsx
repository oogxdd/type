import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { TreeItem } from "../lib/types";
import { SidebarMenu } from "@/shared/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { TreeNode } from "./tree-node";
import { SidebarFileTreeNode } from "./sidebar-file-tree-node";
import { RecentTreeNode } from "./recent-tree-node";
import type { RecentNode } from "./recent-tree-node";
import type { NotePreview } from "@/shared/lib/format";
import { ROOT_ID, dropId, type EdgeSnap } from "../lib/tree-dnd";

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

  // The folder tree is rendered in three places (tabbed folders view, embedded
  // sidebar, and the plain pane). They share the same drop-target root and the
  // same TreeNode mapping, so both live here as helpers instead of inline copies.
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
            {renderDroppablePaneBody(renderTreeNodes())}
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
          {renderDroppablePaneBody(
            embedded ? (
              <SidebarMenu className="sidebar-filetree-menu">
                {treeData.length === 0 ? (
                  <div className="empty">No folders yet.</div>
                ) : null}
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
                {treeData.length === 0 ? (
                  <div className="empty">No folders yet.</div>
                ) : null}
                {renderTreeNodes()}
              </>
            )
          )}
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

