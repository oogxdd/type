import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { TreeItem } from "../tree/types";
import type { DragData, NoteEntry } from "../types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const DROP_PREFIX = "drop";
const ROOT_ID = "root";
const EMPTY_STRING_SET = new Set<string>();

const dropId = (id: string, position: "inside") => `${DROP_PREFIX}:${id}:${position}`;

type EdgeSnap = { id: string; position: "before" | "after" } | null;

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
  indentationWidth: number;
  topAction?: React.ReactNode;
  sectionTitle?: string;
  footer?: React.ReactNode;
};

type TreeRowProps = {
  node: TreeItem;
  depth: number;
  isSelected: boolean;
  hasNestedItems: boolean;
  edgePosition: "before" | "after" | null;
  isCollapsed: boolean;
  onSelect: (event: ReactMouseEvent, id: string) => void;
  onToggle: (event: ReactMouseEvent, id: string) => void;
  renaming: boolean;
  renameValue: string;
  setRenameValue: (value: string) => void;
  submitRenameFolder: () => void;
  cancelRenameFolder: () => void;
  onContextMenu: (event: ReactMouseEvent, id: string) => void;
  indentationWidth: number;
};

function TreeRow({
  node,
  depth,
  isSelected,
  hasNestedItems,
  edgePosition,
  isCollapsed,
  onSelect,
  onToggle,
  renaming,
  renameValue,
  setRenameValue,
  submitRenameFolder,
  cancelRenameFolder,
  onContextMenu,
  indentationWidth,
}: TreeRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: node.id,
    data: { type: "folder", path: node.id } satisfies DragData,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dropId(node.id, "inside"),
    data: { type: "folder", path: node.id } satisfies DragData,
  });

  const setRefs = useCallback(
    (element: HTMLDivElement | null) => {
      setNodeRef(element);
      setDropRef(element);
    },
    [setNodeRef, setDropRef]
  );

  const style = {
    transform: isDragging ? undefined : CSS.Translate.toString(transform),
    paddingLeft: 12 + depth * indentationWidth,
  } as React.CSSProperties;
  const guideBaseLeft = 12 + 20 + 6 + 8;

  return (
    <div
      ref={setRefs}
      style={style}
      className={`item-row folder-row${isSelected ? " selected" : ""}${
        isDragging ? " is-dragging" : ""
      }${isOver && !edgePosition ? " drop-inside" : ""}${
        edgePosition === "before" ? " drop-before" : ""
      }${edgePosition === "after" ? " drop-after" : ""}`}
      data-folder={node.id}
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target && target.closest(".tree-toggle, .rename-input")) {
          return;
        }
        console.log("[folders] select click", node.id);
        onSelect(event, node.id);
      }}
      onContextMenu={(event) => {
        onContextMenu(event, node.id);
      }}
      {...listeners}
      {...attributes}
    >
      {depth > 0 && (
        <span className="tree-guides" aria-hidden>
          {Array.from({ length: depth }, (_, index) => (
            <span
              key={`depth-${index}`}
              className="tree-guide-vert"
              style={{ left: guideBaseLeft + index * indentationWidth }}
            />
          ))}
        </span>
      )}
      {hasNestedItems ? (
        <button
          type="button"
          className={`icon-btn tree-toggle${isCollapsed ? " is-collapsed" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(event, node.id);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          aria-label={isCollapsed ? "Expand folder" : "Collapse folder"}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      ) : (
        <span className="icon-spacer" aria-hidden />
      )}
      {!renaming && (
        <span className="folder-glyph" aria-hidden>
          {hasNestedItems && !isCollapsed ? (
            <svg viewBox="0 0 24 24">
              <path
                d="M3 8a2.5 2.5 0 0 1 2.5-2.5h4L11.4 7h7.1A2.5 2.5 0 0 1 21 9.5V11"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2.8 10.5h18.4a1 1 0 0 1 .96 1.28l-1.65 5.5A2.5 2.5 0 0 1 18.1 19H5.9a2.5 2.5 0 0 1-2.4-1.72l-1.65-5.5a1 1 0 0 1 .95-1.28z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24">
              <path
                d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      )}
      {renaming ? (
        <input
          className="rename-input"
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
        <span className="item-label">{node.name}</span>
      )}
      {!renaming && node.noteCount ? (
        <span className="note-count" title={`${node.noteCount} notes`}>
          {node.noteCount}
        </span>
      ) : null}
    </div>
  );
}

type TreeNodeProps = {
  node: TreeItem;
  depth: number;
  selectedIds: Set<string>;
  selectedNoteIds: Set<string>;
  showNotesAsChildren: boolean;
  edgeSnap: EdgeSnap;
  expanded: Set<string>;
  onSelect: (event: ReactMouseEvent, id: string) => void;
  onToggle: (event: ReactMouseEvent, id: string) => void;
  onNoteSelect: (notePath: string, event: ReactMouseEvent, parentPath: string) => void;
  onNoteContextMenu: (
    event: ReactMouseEvent,
    notePath: string,
    parentPath: string
  ) => void;
  renamingFolder: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  submitRenameFolder: () => void;
  cancelRenameFolder: () => void;
  onContextMenu: (event: ReactMouseEvent, id: string) => void;
  indentationWidth: number;
};

type NavNoteRowProps = {
  note: NoteEntry;
  parentPath: string;
  depth: number;
  indentationWidth: number;
  isSelected: boolean;
  onSelect: (notePath: string, event: ReactMouseEvent, parentPath: string) => void;
  onContextMenu: (
    event: ReactMouseEvent,
    notePath: string,
    parentPath: string
  ) => void;
};

function NavNoteRow({
  note,
  parentPath,
  depth,
  indentationWidth,
  isSelected,
  onSelect,
  onContextMenu,
}: NavNoteRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: note.path,
    data: { type: "note", path: note.path } satisfies DragData,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: note.path,
    data: { type: "note", path: note.path } satisfies DragData,
  });
  const setRefs = useCallback(
    (element: HTMLDivElement | null) => {
      setNodeRef(element);
      setDropRef(element);
    },
    [setDropRef, setNodeRef]
  );
  const style = {
    transform: isDragging ? undefined : CSS.Translate.toString(transform),
    paddingLeft: 12 + depth * indentationWidth,
  } as React.CSSProperties;

  return (
    <div
      ref={setRefs}
      style={style}
      className={`item-row nav-note-row${isSelected ? " selected" : ""}${
        isOver ? " drop-inside" : ""
      }${isDragging ? " is-dragging" : ""}`}
      data-note={note.path}
      onClick={(event) => onSelect(note.path, event, parentPath)}
      onContextMenu={(event) => onContextMenu(event, note.path, parentPath)}
      {...listeners}
      {...attributes}
    >
      <span className="icon-spacer" aria-hidden />
      <span className="nav-note-glyph" aria-hidden>
        <svg viewBox="0 0 24 24">
          <path
            d="M7 3.8h7l3.2 3.2V19a1.2 1.2 0 0 1-1.2 1.2H7A1.2 1.2 0 0 1 5.8 19V5A1.2 1.2 0 0 1 7 3.8z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M13.9 3.8V7h3.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="item-label">{note.name.replace(/\.md$/i, "")}</span>
    </div>
  );
}

type RecentNode = {
  id: string;
  name: string;
  children?: RecentNode[];
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

type RecentTreeNodeProps = {
  node: RecentNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  indentationWidth: number;
};

function RecentTreeNode({ node, depth, expanded, onToggle, indentationWidth }: RecentTreeNodeProps) {
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isCollapsed = hasChildren && !expanded.has(node.id);
  const style = { paddingLeft: 12 + depth * indentationWidth } as React.CSSProperties;

  return (
    <div className="tree-node">
      <div style={style} className="item-row folder-row recent-folder-row" data-recent={node.id}>
        {hasChildren ? (
          <button
            type="button"
            className={`icon-btn tree-toggle${isCollapsed ? " is-collapsed" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(node.id);
            }}
            aria-label={isCollapsed ? "Expand section" : "Collapse section"}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        ) : (
          <span className="icon-spacer" aria-hidden />
        )}
        <span className="folder-glyph" aria-hidden>
          <svg viewBox="0 0 24 24">
            <path
              d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="item-label">{node.name}</span>
      </div>
      {hasChildren && !isCollapsed ? (
        <div className="tree-children">
          {node.children?.map((child) => (
            <RecentTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              indentationWidth={indentationWidth}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  selectedIds,
  selectedNoteIds,
  showNotesAsChildren,
  edgeSnap,
  expanded,
  onSelect,
  onToggle,
  onNoteSelect,
  onNoteContextMenu,
  renamingFolder,
  renameValue,
  setRenameValue,
  submitRenameFolder,
  cancelRenameFolder,
  onContextMenu,
  indentationWidth,
}: TreeNodeProps) {
  const edgePosition = edgeSnap?.id === node.id ? edgeSnap.position : null;
  const notes = showNotesAsChildren ? node.notes || [] : [];
  const hasNestedItems = node.children.length > 0 || notes.length > 0;
  const isCollapsed = hasNestedItems && !expanded.has(node.id);

  return (
    <div className="tree-node">
      <TreeRow
        node={node}
        depth={depth}
        isSelected={selectedIds.has(node.id)}
        hasNestedItems={hasNestedItems}
        edgePosition={edgePosition}
        isCollapsed={isCollapsed}
        onSelect={onSelect}
        onToggle={onToggle}
        renaming={renamingFolder === node.id}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        submitRenameFolder={submitRenameFolder}
        cancelRenameFolder={cancelRenameFolder}
        onContextMenu={onContextMenu}
        indentationWidth={indentationWidth}
      />
      {hasNestedItems && !isCollapsed && (
        <div className="tree-children">
          {notes.map((note) => (
            <NavNoteRow
              key={note.path}
              note={note}
              parentPath={node.id}
              depth={depth + 1}
              indentationWidth={indentationWidth}
              isSelected={selectedNoteIds.has(note.path)}
              onSelect={onNoteSelect}
              onContextMenu={onNoteContextMenu}
            />
          ))}
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              showNotesAsChildren={showNotesAsChildren}
              selectedNoteIds={selectedNoteIds}
              edgeSnap={edgeSnap}
              expanded={expanded}
              onSelect={onSelect}
              onToggle={onToggle}
              onNoteSelect={onNoteSelect}
              onNoteContextMenu={onNoteContextMenu}
              selectedIds={selectedIds}
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
      )}
    </div>
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
  indentationWidth,
  topAction,
  sectionTitle,
  footer,
}: FoldersPanelProps) {
  const [activeTab, setActiveTab] = useState<"recent" | "folders">(
    showNotesAsChildren ? "folders" : "recent"
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
    if (showNotesAsChildren) {
      setActiveTab("folders");
    }
  }, [showNotesAsChildren]);

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

  return (
    <div className="pane tree-pane nav-pane">
      {topAction ? <div className="pane-top">{topAction}</div> : null}
      <div className="pane-section">
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
                {sectionTitle}
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
      </div>
      {footer ? <div className="pane-footer">{footer}</div> : null}
    </div>
  );
}

export { DROP_PREFIX, ROOT_ID, dropId };
