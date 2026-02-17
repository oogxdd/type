export type RecentNode = {
  id: string;
  name: string;
  children?: RecentNode[];
};

export type RecentTreeNodeProps = {
  node: RecentNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  indentationWidth: number;
};

export function RecentTreeNode({ node, depth, expanded, onToggle, indentationWidth }: RecentTreeNodeProps) {
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
