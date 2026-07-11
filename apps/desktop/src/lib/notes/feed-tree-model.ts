import type { NoteEntry } from "@typenotes/shared/types";
import type { NotePreview } from "@typenotes/shared/format";

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
  rangeStartMs: number | null;
  rangeEndMs: number | null;
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
  rangeStartMs: number | null;
  rangeEndMs: number | null;
  children: Map<string, FeedNodeBuilder>;
  notes: Array<NoteEntry & { timestampMs: number }>;
  latestMs: number;
  rank: number;
  calendarEnsured?: boolean;
};

// Intl is the hot path of this module: building the feed for thousands of
// notes used to spend seconds inside toLocaleDateString/localeCompare. Labels
// are deterministic per weekday/month/week, so they are cached, and one shared
// Collator replaces per-call localeCompare in the sorts.
const nameCollator = new Intl.Collator();
const compareNames = (left: string, right: string) => nameCollator.compare(left, right);

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
  rank: number,
  rangeStartMs: number | null = null,
  rangeEndMs: number | null = null
): FeedNodeBuilder => ({
  id,
  name,
  kind,
  parentId,
  rangeStartMs,
  rangeEndMs,
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
  rank: number,
  rangeStartMs: number | null = null,
  rangeEndMs: number | null = null
) => {
  const existing = parent.children.get(id);
  if (existing) {
    return existing;
  }
  const next = createBuilder(
    id,
    name,
    kind,
    parent.id,
    rank,
    rangeStartMs,
    rangeEndMs
  );
  parent.children.set(id, next);
  return next;
};

const getStartOfDayMs = (date: Date) => {
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return value.getTime();
};

const getEndOfDayMs = (date: Date) =>
  new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999
  ).getTime();

type FeedDateRange = {
  rangeStartMs: number;
  rangeEndMs: number;
};

const clampRangeEnd = (rangeEndMs: number, now: Date) =>
  Math.min(rangeEndMs, now.getTime());

const getDayRange = (date: Date, now: Date): FeedDateRange => ({
  rangeStartMs: getStartOfDayMs(date),
  rangeEndMs: clampRangeEnd(getEndOfDayMs(date), now),
});

const getMonthRange = (date: Date, now: Date): FeedDateRange => ({
  rangeStartMs: new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
  rangeEndMs: clampRangeEnd(
    new Date(
      date.getFullYear(),
      date.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    ).getTime(),
    now
  ),
});

const getYearRange = (date: Date, now: Date): FeedDateRange => ({
  rangeStartMs: new Date(date.getFullYear(), 0, 1).getTime(),
  rangeEndMs: clampRangeEnd(
    new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999).getTime(),
    now
  ),
});

const getFirstMondayDay = (date: Date) =>
  1 + ((8 - new Date(date.getFullYear(), date.getMonth(), 1).getDay()) % 7);

const getWeekOfMonth = (date: Date) => {
  const firstMonday = getFirstMondayDay(date);
  if (date.getDate() < firstMonday) {
    return 0;
  }
  return Math.floor((date.getDate() - firstMonday) / 7) + 1;
};

const getWeekDateBounds = (date: Date, week = getWeekOfMonth(date)) => {
  const firstMonday = getFirstMondayDay(date);
  const startDay = week === 0 ? 1 : firstMonday + (week - 1) * 7;
  const endDay = Math.min(
    week === 0 ? firstMonday - 1 : startDay + 6,
    new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  );
  return {
    week,
    start: new Date(date.getFullYear(), date.getMonth(), startDay),
    end: new Date(
      date.getFullYear(),
      date.getMonth(),
      endDay,
      23,
      59,
      59,
      999
    ),
  };
};

const getWeekRange = (date: Date, now: Date): FeedDateRange => {
  const { start, end } = getWeekDateBounds(date);
  return {
    rangeStartMs: start.getTime(),
    rangeEndMs: clampRangeEnd(end.getTime(), now),
  };
};

const weekRangeLabelCache = new Map<string, string>();

const getWeekRangeLabel = (date: Date, week = getWeekOfMonth(date)) => {
  const cacheKey = `${date.getFullYear()}:${date.getMonth()}:${week}`;
  const cached = weekRangeLabelCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const { start, end } = getWeekDateBounds(date, week);
  const formatDate = (value: Date) =>
    value.toLocaleDateString([], {
      month: "long",
      day: "numeric",
    });
  const prefix = week === 0 ? "Month start" : `Week ${week}`;
  const label = `${prefix} (${formatDate(start)} - ${formatDate(end)})`;
  weekRangeLabelCache.set(cacheKey, label);
  return label;
};

const getQuarter = (date: Date) => Math.floor(date.getMonth() / 3) + 1;

const getQuarterRange = (date: Date, now: Date): FeedDateRange => {
  const firstMonth = (getQuarter(date) - 1) * 3;
  return {
    rangeStartMs: new Date(date.getFullYear(), firstMonth, 1).getTime(),
    rangeEndMs: clampRangeEnd(
      new Date(
        date.getFullYear(),
        firstMonth + 3,
        0,
        23,
        59,
        59,
        999
      ).getTime(),
      now
    ),
  };
};

const getQuarterSortRank = (quarter: number) => 4 - quarter;

const getMonthSortRank = (date: Date) => 12 - (date.getMonth() + 1);

const getYearSortRank = (year: number) => 10_000 - year;

const titleCase = (value: string) =>
  value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;

const monthLabelCache = new Map<number, string>();

const getMonthLabel = (date: Date) => {
  const cacheKey = date.getMonth();
  const cached = monthLabelCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const label = date.toLocaleDateString([], {
    month: "long",
  });
  monthLabelCache.set(cacheKey, label);
  return label;
};

const weekdayLabelCache = new Map<number, string>();

const getWeekdayLabel = (date: Date) => {
  const cacheKey = date.getDay();
  const cached = weekdayLabelCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const label = titleCase(
    date.toLocaleDateString([], {
      weekday: "long",
    })
  );
  weekdayLabelCache.set(cacheKey, label);
  return label;
};

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

const addNoteToMonth = (
  month: FeedNodeBuilder,
  monthPathSegments: Array<string | number>,
  note: NoteEntry,
  timestampMs: number,
  date: Date,
  now: Date
) => {
  const week = getWeekOfMonth(date);
  const weekPathSegments = [...monthPathSegments, "week", week];
  const weekRange = getWeekRange(date, now);
  const weekNode = ensureBuilder(
    month,
    buildPathSegments(weekPathSegments),
    getWeekRangeLabel(date),
    "week",
    week,
    weekRange.rangeStartMs,
    weekRange.rangeEndMs
  );
  const dayRange = getDayRange(date, now);
  const dayNode = ensureBuilder(
    weekNode,
    buildPathSegments([...weekPathSegments, "day", date.getDate()]),
    getWeekdayLabel(date),
    "day",
    date.getDate(),
    dayRange.rangeStartMs,
    dayRange.rangeEndMs
  );
  addNoteToBuilder(dayNode, note, timestampMs);
};

const ensureMonthCalendar = (
  month: FeedNodeBuilder,
  monthPathSegments: Array<string | number>,
  date: Date,
  now: Date
) => {
  // The calendar skeleton depends only on (year, month, now) — build it once
  // per month builder instead of once per note.
  if (month.calendarEnsured) {
    return;
  }
  month.calendarEnsured = true;
  const monthEndDay = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0
  ).getDate();
  const visibleEndDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth()
      ? Math.min(monthEndDay, now.getDate())
      : monthEndDay;
  const firstMonday = getFirstMondayDay(date);
  const firstWeek = firstMonday > 1 ? 0 : 1;
  const lastWeek = getWeekOfMonth(
    new Date(date.getFullYear(), date.getMonth(), visibleEndDay)
  );

  for (let week = firstWeek; week <= lastWeek; week += 1) {
    const bounds = getWeekDateBounds(date, week);
    if (bounds.start.getDate() > visibleEndDay) {
      break;
    }
    const endDay = Math.min(bounds.end.getDate(), visibleEndDay);
    const rangeDate = new Date(
      date.getFullYear(),
      date.getMonth(),
      bounds.start.getDate()
    );
    const weekPathSegments = [...monthPathSegments, "week", week];
    const weekRange = getWeekRange(rangeDate, now);
    const weekNode = ensureBuilder(
      month,
      buildPathSegments(weekPathSegments),
      getWeekRangeLabel(date, week),
      "week",
      week,
      weekRange.rangeStartMs,
      Math.min(
        weekRange.rangeEndMs,
        getEndOfDayMs(
          new Date(date.getFullYear(), date.getMonth(), endDay)
        )
      )
    );

    for (
      let day = bounds.start.getDate();
      day <= endDay;
      day += 1
    ) {
      const dayDate = new Date(date.getFullYear(), date.getMonth(), day);
      const dayRange = getDayRange(dayDate, now);
      ensureBuilder(
        weekNode,
        buildPathSegments([...weekPathSegments, "day", day]),
        getWeekdayLabel(dayDate),
        "day",
        day,
        dayRange.rangeStartMs,
        dayRange.rangeEndMs
      );
    }
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
      return compareNames(left.name, right.name);
    });
  const noteCount = builder.notes.length + children.reduce((total, child) => total + child.noteCount, 0);
  return {
    id: builder.id,
    name: builder.name,
    kind: builder.kind,
    parentId: builder.parentId,
    rangeStartMs: builder.rangeStartMs,
    rangeEndMs: builder.rangeEndMs,
    children,
    notes: [...builder.notes].sort((left, right) => {
      if (left.timestampMs !== right.timestampMs) {
        return right.timestampMs - left.timestampMs;
      }
      return compareNames(left.name, right.name);
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
    const todayRange = getDayRange(now, now);
    const today = ensureBuilder(
      root,
      buildPathSegments(["today"]),
      getSpecialLabel("today"),
      "special",
      SPECIAL_GROUP_ORDER.today,
      todayRange.rangeStartMs,
      todayRange.rangeEndMs
    );
    addNoteToBuilder(today, note, timestampMs);
    return;
  }

  if (ageDays === 1) {
    const yesterdayRange = getDayRange(date, now);
    const yesterday = ensureBuilder(
      root,
      buildPathSegments(["yesterday"]),
      getSpecialLabel("yesterday"),
      "special",
      SPECIAL_GROUP_ORDER.yesterday,
      yesterdayRange.rangeStartMs,
      yesterdayRange.rangeEndMs
    );
    addNoteToBuilder(yesterday, note, timestampMs);
    return;
  }

  if (ageDays < 7) {
    const lastWeekStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 6
    );
    const lastWeekEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 2,
      23,
      59,
      59,
      999
    );
    const lastWeek = ensureBuilder(
      root,
      buildPathSegments(["last-week"]),
      getSpecialLabel("last-week"),
      "special",
      SPECIAL_GROUP_ORDER["last-week"],
      lastWeekStart.getTime(),
      lastWeekEnd.getTime()
    );
    const dayId = buildPathSegments(["last-week", "day", date.getDay()]);
    const dayRange = getDayRange(date, now);
    const day = ensureBuilder(
      lastWeek,
      dayId,
      getWeekdayLabel(date),
      "day",
      getWeekdayOrder(date),
      dayRange.rangeStartMs,
      dayRange.rangeEndMs
    );
    addNoteToBuilder(day, note, timestampMs);
    return;
  }

  if (date.getFullYear() === now.getFullYear()) {
    const monthPathSegments = [
      "month",
      date.getFullYear(),
      date.getMonth() + 1,
    ];
    const monthId = buildPathSegments(monthPathSegments);
    const monthRange = getMonthRange(date, now);
    const month = ensureBuilder(
      root,
      monthId,
      getMonthLabel(date),
      "month",
      10 + getMonthSortRank(date),
      monthRange.rangeStartMs,
      monthRange.rangeEndMs
    );
    ensureMonthCalendar(month, monthPathSegments, date, now);
    addNoteToMonth(month, monthPathSegments, note, timestampMs, date, now);
    return;
  }

  const yearId = buildPathSegments(["year", date.getFullYear()]);
  const yearRange = getYearRange(date, now);
  const year = ensureBuilder(
    root,
    yearId,
    String(date.getFullYear()),
    "year",
    getYearSortRank(date.getFullYear()),
    yearRange.rangeStartMs,
    yearRange.rangeEndMs
  );
  const quarter = getQuarter(date);
  const quarterId = buildPathSegments(["year", date.getFullYear(), "quarter", quarter]);
  const quarterRange = getQuarterRange(date, now);
  const quarterNode = ensureBuilder(
    year,
    quarterId,
    `Q${quarter}`,
    "quarter",
    getQuarterSortRank(quarter),
    quarterRange.rangeStartMs,
    quarterRange.rangeEndMs
  );
  const monthPathSegments = [
    "year",
    date.getFullYear(),
    "quarter",
    quarter,
    "month",
    date.getMonth() + 1,
  ];
  const monthId = buildPathSegments(monthPathSegments);
  const monthRange = getMonthRange(date, now);
  const monthNode = ensureBuilder(
    quarterNode,
    monthId,
    getMonthLabel(date),
    "month",
    10 + getMonthSortRank(date),
    monthRange.rangeStartMs,
    monthRange.rangeEndMs
  );
  ensureMonthCalendar(monthNode, monthPathSegments, date, now);
  addNoteToMonth(monthNode, monthPathSegments, note, timestampMs, date, now);
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
      return compareNames(left.name, right.name);
    });

  const nodeById = new Map<string, FeedTreeNode>();
  const walk = (node: FeedTreeNode) => {
    nodeById.set(node.id, node);
    node.children.forEach(walk);
  };
  treeData.forEach(walk);
  return { treeData, nodeById };
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
      return compareNames(left.name, right.name);
    });
  node.children.forEach((child) => {
    notes.push(...collectFeedNotes(child));
  });
  return notes.sort((left, right) => {
    if (left.timestampMs !== right.timestampMs) {
      return right.timestampMs - left.timestampMs;
    }
    return compareNames(left.name, right.name);
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

export function getLatestFeedTargetTimestamp(
  node: FeedTreeNode | null,
  now: Date = new Date()
): number | null {
  if (node?.rangeStartMs == null || node.rangeEndMs == null) {
    return null;
  }
  const latestMs = Math.min(node.rangeEndMs, now.getTime());
  return latestMs >= node.rangeStartMs ? latestMs : null;
}
