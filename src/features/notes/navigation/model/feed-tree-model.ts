import type { NoteEntry, VisibleNavigationItem } from "@/shared/types";
import type { NotePreview } from "@/shared/lib/format";

// Feed is not the folder tree. It is a synthetic hierarchy built from note
// timestamps so the navigation UI can browse recent work by time bucket.
export type FeedTreeNodeKind =
  | "special"
  | "year"
  | "quarter"
  | "month"
  | "week"
  | "day"
  | "undated";

export type FeedTreeNode = {
  id: string;
  name: string;
  kind: FeedTreeNodeKind;
  parentId: string | null;
  children: FeedTreeNode[];
  notes: Array<NoteEntry & { timestampMs: number }>;
  noteCount: number;
  latestMs: number;
  rank: number;
};

export type FeedTreeBuildResult = {
  treeData: FeedTreeNode[];
  nodeById: Map<string, FeedTreeNode>;
};

type FeedNodeBuilder = {
  id: string;
  name: string;
  kind: FeedTreeNodeKind;
  parentId: string | null;
  children: Map<string, FeedNodeBuilder>;
  notes: Array<NoteEntry & { timestampMs: number }>;
  latestMs: number;
  rank: number;
};

const DAY_MS = 86_400_000;

const SPECIAL_GROUP_ORDER: Record<string, number> = {
  today: 0,
  yesterday: 1,
  "last-week": 2,
  undated: 99_999,
};

const getWeekdayOrder = (date: Date) => (date.getDay() + 6) % 7;

const createBuilder = (
  id: string,
  name: string,
  kind: FeedTreeNodeKind,
  parentId: string | null,
  rank: number
): FeedNodeBuilder => ({
  id,
  name,
  kind,
  parentId,
  children: new Map(),
  notes: [],
  latestMs: 0,
  rank,
});

const ensureBuilder = (
  parent: FeedNodeBuilder,
  id: string,
  name: string,
  kind: FeedTreeNodeKind,
  rank: number
) => {
  const existing = parent.children.get(id);
  if (existing) {
    return existing;
  }
  const next = createBuilder(id, name, kind, parent.id, rank);
  parent.children.set(id, next);
  return next;
};

const getStartOfDayMs = (date: Date) => {
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return value.getTime();
};

const getWeekOfMonth = (date: Date) => Math.floor((date.getDate() - 1) / 7) + 1;

const getQuarter = (date: Date) => Math.floor(date.getMonth() / 3) + 1;

const getQuarterSortRank = (quarter: number) => 4 - quarter;

const getMonthSortRank = (date: Date) => 12 - (date.getMonth() + 1);

const getYearSortRank = (year: number) => 10_000 - year;

const titleCase = (value: string) =>
  value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;

const getMonthLabel = (date: Date) =>
  date.toLocaleDateString([], {
    month: "long",
  });

const getWeekdayLabel = (date: Date) =>
  titleCase(
    date.toLocaleDateString([], {
      weekday: "long",
    })
  );

const getSpecialLabel = (kind: "today" | "yesterday" | "last-week" | "undated") => {
  if (kind === "today") return "Today";
  if (kind === "yesterday") return "Yesterday";
  if (kind === "last-week") return "Last week";
  return "Undated";
};

const buildPathSegments = (segments: Array<string | number>) =>
  `feed:${segments.map((segment) => String(segment)).join(":")}`;

const getUndatedNode = (root: FeedNodeBuilder) =>
  ensureBuilder(
    root,
    buildPathSegments(["undated"]),
    getSpecialLabel("undated"),
    "undated",
    SPECIAL_GROUP_ORDER.undated
  );

const addNoteToBuilder = (builder: FeedNodeBuilder, note: NoteEntry, timestampMs: number) => {
  builder.notes.push({ ...note, timestampMs });
  if (timestampMs > builder.latestMs) {
    builder.latestMs = timestampMs;
  }
};

const finalizeBuilder = (builder: FeedNodeBuilder): FeedTreeNode => {
  const children = [...builder.children.values()]
    .map((child) => finalizeBuilder(child))
    .sort((left, right) => {
      if (left.rank !== right.rank) {
        return left.rank - right.rank;
      }
      if (left.latestMs !== right.latestMs) {
        return right.latestMs - left.latestMs;
      }
      return left.name.localeCompare(right.name);
    });
  const noteCount = builder.notes.length + children.reduce((total, child) => total + child.noteCount, 0);
  return {
    id: builder.id,
    name: builder.name,
    kind: builder.kind,
    parentId: builder.parentId,
    children,
    notes: [...builder.notes].sort((left, right) => {
      if (left.timestampMs !== right.timestampMs) {
        return right.timestampMs - left.timestampMs;
      }
      return left.name.localeCompare(right.name);
    }),
    noteCount,
    latestMs: builder.latestMs,
    rank: builder.rank,
  };
};

const getFeedTimestamp = (preview?: NotePreview) =>
  preview?.createdMs ?? preview?.updatedMs ?? null;

const addRecentNote = (
  root: FeedNodeBuilder,
  note: NoteEntry,
  timestampMs: number,
  now: Date
) => {
  const date = new Date(timestampMs);
  const ageDays = Math.floor(
    (getStartOfDayMs(now) - getStartOfDayMs(date)) / DAY_MS
  );
  if (ageDays <= 0) {
    const today = ensureBuilder(
      root,
      buildPathSegments(["today"]),
      getSpecialLabel("today"),
      "special",
      SPECIAL_GROUP_ORDER.today
    );
    addNoteToBuilder(today, note, timestampMs);
    return;
  }

  if (ageDays === 1) {
    const yesterday = ensureBuilder(
      root,
      buildPathSegments(["yesterday"]),
      getSpecialLabel("yesterday"),
      "special",
      SPECIAL_GROUP_ORDER.yesterday
    );
    addNoteToBuilder(yesterday, note, timestampMs);
    return;
  }

  if (ageDays < 7) {
    const lastWeek = ensureBuilder(
      root,
      buildPathSegments(["last-week"]),
      getSpecialLabel("last-week"),
      "special",
      SPECIAL_GROUP_ORDER["last-week"]
    );
    const dayId = buildPathSegments(["last-week", "day", date.getDay()]);
    const day = ensureBuilder(
      lastWeek,
      dayId,
      getWeekdayLabel(date),
      "day",
      getWeekdayOrder(date)
    );
    addNoteToBuilder(day, note, timestampMs);
    return;
  }

  if (date.getFullYear() === now.getFullYear()) {
    const monthId = buildPathSegments(["month", date.getFullYear(), date.getMonth() + 1]);
    const month = ensureBuilder(
      root,
      monthId,
      getMonthLabel(date),
      "month",
      10 + getMonthSortRank(date)
    );
    addNoteToBuilder(month, note, timestampMs);
    return;
  }

  const yearId = buildPathSegments(["year", date.getFullYear()]);
  const year = ensureBuilder(
    root,
    yearId,
    String(date.getFullYear()),
    "year",
    getYearSortRank(date.getFullYear())
  );
  const quarter = getQuarter(date);
  const quarterId = buildPathSegments(["year", date.getFullYear(), "quarter", quarter]);
  const quarterNode = ensureBuilder(
    year,
    quarterId,
    `Q${quarter}`,
    "quarter",
    getQuarterSortRank(quarter)
  );
  const monthId = buildPathSegments([
    "year",
    date.getFullYear(),
    "quarter",
    quarter,
    "month",
    date.getMonth() + 1,
  ]);
  const monthNode = ensureBuilder(
    quarterNode,
    monthId,
    getMonthLabel(date),
    "month",
    10 + getMonthSortRank(date)
  );
  const weekId = buildPathSegments([
    "year",
    date.getFullYear(),
    "quarter",
    quarter,
    "month",
    date.getMonth() + 1,
    "week",
    getWeekOfMonth(date),
  ]);
  const weekNode = ensureBuilder(
    monthNode,
    weekId,
    `Week ${getWeekOfMonth(date)}`,
    "week",
    getWeekOfMonth(date)
  );
  const dayId = buildPathSegments([
    "year",
    date.getFullYear(),
    "quarter",
    quarter,
    "month",
    date.getMonth() + 1,
    "week",
    getWeekOfMonth(date),
    "day",
    date.getDate(),
  ]);
  const dayNode = ensureBuilder(
    weekNode,
    dayId,
    getWeekdayLabel(date),
    "day",
    getWeekdayOrder(date)
  );
  addNoteToBuilder(dayNode, note, timestampMs);
};

export function buildFeedTree(
  notes: NoteEntry[],
  previews: Record<string, NotePreview>,
  hideArchivedNotes: boolean
): FeedTreeBuildResult {
  const now = new Date();
  const root = createBuilder("feed:root", "Feed", "special", null, 0);

  notes.forEach((note) => {
    const preview = previews[note.path];
    if (!preview) {
      return;
    }
    if (hideArchivedNotes && preview.isArchived) {
      return;
    }
    const timestampMs = getFeedTimestamp(preview);
    if (timestampMs == null) {
      const undated = getUndatedNode(root);
      addNoteToBuilder(undated, note, 0);
      return;
    }
    const date = new Date(timestampMs);
    if (Number.isNaN(date.getTime())) {
      addNoteToBuilder(getUndatedNode(root), note, 0);
      return;
    }
    addRecentNote(root, note, timestampMs, now);
  });

  const treeData = [...root.children.values()]
    .map((child) => finalizeBuilder(child))
    .sort((left, right) => {
      if (left.rank !== right.rank) {
        return left.rank - right.rank;
      }
      if (left.latestMs !== right.latestMs) {
        return right.latestMs - left.latestMs;
      }
      return left.name.localeCompare(right.name);
    });

  const nodeById = new Map<string, FeedTreeNode>();
  const walk = (node: FeedTreeNode) => {
    nodeById.set(node.id, node);
    node.children.forEach(walk);
  };
  treeData.forEach(walk);
  return { treeData, nodeById };
}

export function buildVisibleFeedNavigationItems(
  treeData: FeedTreeNode[],
  expanded: Set<string>,
  shouldNestNotesInNavigation: boolean
): VisibleNavigationItem[] {
  const items: VisibleNavigationItem[] = [];

  const walk = (nodes: FeedTreeNode[], parentId: string | null) => {
    nodes.forEach((node) => {
      items.push({
        type: "folder",
        id: node.id,
        parentId,
      });

      const noteRows = shouldNestNotesInNavigation ? node.notes : [];
      const hasNestedItems = node.children.length > 0 || noteRows.length > 0;
      if (!hasNestedItems || !expanded.has(node.id)) {
        return;
      }

      noteRows.forEach((note) => {
        items.push({
          type: "note",
          id: note.path,
          parentId: node.id,
        });
      });

      walk(node.children, node.id);
    });
  };

  walk(treeData, null);
  return items;
}

export function collectFeedNotes(
  node: FeedTreeNode | null
): Array<NoteEntry & { timestampMs: number }> {
  if (!node) {
    return [];
  }
  const notes = [...node.notes]
    .sort((left, right) => {
      if (left.timestampMs !== right.timestampMs) {
        return right.timestampMs - left.timestampMs;
      }
      return left.name.localeCompare(right.name);
    });
  node.children.forEach((child) => {
    notes.push(...collectFeedNotes(child));
  });
  return notes.sort((left, right) => {
    if (left.timestampMs !== right.timestampMs) {
      return right.timestampMs - left.timestampMs;
    }
    return left.name.localeCompare(right.name);
  });
}

export function getFirstFeedGroupId(treeData: FeedTreeNode[]): string {
  return treeData[0]?.id ?? "";
}

export function findFeedNode(
  treeData: FeedTreeNode[],
  targetId: string
): FeedTreeNode | null {
  for (const node of treeData) {
    if (node.id === targetId) {
      return node;
    }
    const match = findFeedNode(node.children, targetId);
    if (match) {
      return match;
    }
  }
  return null;
}
