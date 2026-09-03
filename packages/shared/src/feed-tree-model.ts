import type { NoteEntry } from "./types";
import type { NotePreview } from "./format";
// The predicate lives in @typenotes/shared so the mobile feed filters by the
// same rules; re-exported here because this module is where the desktop's
// filter type has always been imported from.
import {
  matchesFeedFilter,
  type FeedNoteFilter,
} from "./note-filter";

export type { FeedNoteFilter };

// Feed is not the folder tree. It is a synthetic hierarchy built from note
// timestamps so the navigation UI can browse recent work by time bucket.
//
// Shape of the tree (today = Fri 4 Sep 2026, for example):
//
//   This week                               <- visual section (rendered by UI)
//     Monday
//     Tuesday
//     ...                                   <- all seven days, even when empty
//   Earlier                                 <- visual section (rendered by UI)
//     August
//       Week 4 (24–30 aug)
//       Week 3 (17–23 aug)
//         Monday (17aug)
//         ...
//     July
//
// The model returns date nodes themselves; the Feed UI adds the two small
// section labels. This keeps labels out of keyboard navigation and out of the
// selectable/back-dateable node map.
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
  secondaryName: string | null;
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
  secondaryName: string | null;
  kind: FeedTreeNodeKind;
  parentId: string | null;
  rangeStartMs: number | null;
  rangeEndMs: number | null;
  children: Map<string, FeedNodeBuilder>;
  notes: Array<NoteEntry & { timestampMs: number }>;
  latestMs: number;
  rank: number;
};

// Intl is the hot path of this module: building the feed for thousands of
// notes used to spend seconds inside toLocaleDateString/localeCompare. Labels
// are deterministic per weekday/month/week, so they are cached, and one shared
// Collator replaces per-call localeCompare in the sorts.
const nameCollator = new Intl.Collator();
const compareNames = (left: string, right: string) => nameCollator.compare(left, right);

const WEEK_MS = 604_800_000;

// The feed has two halves and every note lands in exactly one: the current
// Monday–Sunday week, or the earlier Month → Week → Day calendar hierarchy.
const UNDATED_RANK = 99_999;

// Every level of the feed reads newest-first, so calendar nodes are ranked by
// negated range start rather than by ascending week/day number.
const getChronologicalRank = (startMs: number) => -startMs;

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
  secondaryName: null,
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

// --- ISO weeks -------------------------------------------------------------
// Feed weeks are ISO-8601 weeks: always Monday -> Sunday, never clipped at a
// month boundary. A week straddling two months stays ONE node holding all seven
// days; which month it hangs under is a policy decision — see
// getWeekOwnerMonths, the single place to change it.

const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const getIsoWeekStart = (date: Date) =>
  addDays(date, -((date.getDay() + 6) % 7));

// Week 1 of an ISO year is the week whose Thursday falls in that year (that is,
// the week holding January 4th), so the number is derived from the Thursday.
// Note this number is independent of the ownership policy below: changing which
// month a week hangs under never renumbers it.
const getIsoWeekNumber = (weekStart: Date) => {
  const thursday = addDays(weekStart, 3);
  const firstThursday = addDays(
    getIsoWeekStart(new Date(thursday.getFullYear(), 0, 4)),
    3
  );
  // Rounding absorbs the ±1h a DST switch puts between two local midnights.
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / WEEK_MS);
};

type MonthKey = { year: number; monthIndex: number };

const monthKeyOf = (date: Date): MonthKey => ({
  year: date.getFullYear(),
  monthIndex: date.getMonth(),
});

/**
 * Which calendar month a week hangs under. ISO weeks straddle month boundaries,
 * so this is a *policy*, not a fact.
 *
 * Current policy — the ISO rule: the week belongs to the month containing its
 * Thursday, i.e. the month owning the majority of its days. The week of
 * Jul 27 – Aug 2 2026 therefore hangs under July, and so does Jun 29 – Jul 5.
 * A consequence worth knowing: a week node's range can stick out past its
 * month node's range. Nothing depends on containment, but don't add code that
 * assumes it.
 *
 * Alternatives, both already supported by the call sites:
 *  - "the week starts in this month": `return [monthKeyOf(weekStart)];`
 *  - "show the week under both months": return both keys —
 *      `[monthKeyOf(weekStart), monthKeyOf(addDays(weekStart, 6))]`, deduped
 *    when the week sits inside one month. Each copy then collects only the days
 *    belonging to its own month, because pickWeekOwnerMonth() routes each note
 *    to the matching copy. The week shows up twice; no note is duplicated.
 *    Weeks are keyed by ISO number under their owner month, so the two copies
 *    still get distinct node ids.
 */
const getWeekOwnerMonths = (weekStart: Date): MonthKey[] => [
  monthKeyOf(addDays(weekStart, 3)),
];

/**
 * Picks the owner copy a note belongs to. Only meaningful when
 * getWeekOwnerMonths returns more than one month (the "duplicate across months"
 * policy); with a single owner it is that owner.
 */
const pickWeekOwnerMonth = (owners: MonthKey[], date: Date) =>
  owners.find(
    (owner) =>
      owner.year === date.getFullYear() && owner.monthIndex === date.getMonth()
  ) ?? owners[0];

const getWeekRange = (weekStart: Date, now: Date): FeedDateRange => ({
  rangeStartMs: weekStart.getTime(),
  rangeEndMs: clampRangeEnd(getEndOfDayMs(addDays(weekStart, 6)), now),
});

const weekLabelCache = new Map<number, string>();

const getShortMonthLabel = (date: Date) =>
  date.toLocaleDateString([], { month: "short" }).toLocaleLowerCase();

const getMonthWeekNumber = (weekStart: Date) => {
  const owner = addDays(weekStart, 3);
  const monthStart = new Date(owner.getFullYear(), owner.getMonth(), 1);
  let firstOwnedWeek = getIsoWeekStart(monthStart);
  if (addDays(firstOwnedWeek, 3).getMonth() !== owner.getMonth()) {
    firstOwnedWeek = addDays(firstOwnedWeek, 7);
  }
  return 1 + Math.round((weekStart.getTime() - firstOwnedWeek.getTime()) / WEEK_MS);
};

const getWeekLabel = (weekStart: Date) => {
  const cacheKey = weekStart.getTime();
  const cached = weekLabelCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const weekEnd = addDays(weekStart, 6);
  const formatDay = (value: Date) =>
    `${value.getDate()} ${getShortMonthLabel(value)}`;
  const range =
    weekStart.getMonth() === weekEnd.getMonth()
      ? `${weekStart.getDate()}–${formatDay(weekEnd)}`
      : `${formatDay(weekStart)}–${formatDay(weekEnd)}`;
  const label = `Week ${getMonthWeekNumber(weekStart)} (${range})`;
  weekLabelCache.set(cacheKey, label);
  return label;
};

type FeedBoundaries = { thisWeekStartMs: number; nextWeekStartMs: number };

const getFeedBoundaries = (now: Date): FeedBoundaries => {
  const thisWeekStart = getIsoWeekStart(now);
  return {
    thisWeekStartMs: thisWeekStart.getTime(),
    nextWeekStartMs: addDays(thisWeekStart, 7).getTime(),
  };
};

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

const weekdayNameCache = new Map<number, string>();

const getWeekdayName = (date: Date) => {
  const cacheKey = date.getDay();
  const cached = weekdayNameCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const label = titleCase(
    date.toLocaleDateString([], {
      weekday: "long",
    })
  );
  weekdayNameCache.set(cacheKey, label);
  return label;
};

const getCalendarDaySecondaryLabel = (date: Date) =>
  `(${date.getDate()}${getShortMonthLabel(date)})`;

const buildPathSegments = (segments: Array<string | number>) =>
  `feed:${segments.map((segment) => String(segment)).join(":")}`;

const getUndatedNode = (root: FeedNodeBuilder) =>
  ensureBuilder(
    root,
    buildPathSegments(["undated"]),
    "Undated",
    "undated",
    UNDATED_RANK
  );

const addNoteToBuilder = (builder: FeedNodeBuilder, note: NoteEntry, timestampMs: number) => {
  builder.notes.push({ ...note, timestampMs });
  if (timestampMs > builder.latestMs) {
    builder.latestMs = timestampMs;
  }
};

// A day row under any bucket: relative ("This week") or calendar (an ISO week).
const addNoteToDay = (
  parent: FeedNodeBuilder,
  parentPathSegments: Array<string | number>,
  note: NoteEntry,
  timestampMs: number,
  date: Date,
  now: Date
) => {
  const dayRange = getDayRange(date, now);
  // Seven consecutive dates can never repeat a day of month, so the day number
  // alone keys a day uniquely inside its week.
  const dayNode = ensureBuilder(
    parent,
    buildPathSegments([...parentPathSegments, "day", date.getDate()]),
    getWeekdayName(date),
    "day",
    getChronologicalRank(dayRange.rangeStartMs),
    dayRange.rangeStartMs,
    dayRange.rangeEndMs
  );
  dayNode.secondaryName = getCalendarDaySecondaryLabel(date);
  addNoteToBuilder(dayNode, note, timestampMs);
};

// Earlier months all sit directly below the visual "Earlier" label. Older
// years include the year in their label so repeated month names stay clear.
const ensureCalendarMonth = (
  root: FeedNodeBuilder,
  owner: MonthKey,
  now: Date
) => {
  const monthDate = new Date(owner.year, owner.monthIndex, 1);
  const monthRange = getMonthRange(monthDate, now);
  const monthsAgo =
    (now.getFullYear() - owner.year) * 12 + now.getMonth() - owner.monthIndex;
  const monthRank = 10 + monthsAgo;
  const monthPathSegments = ["month", owner.year, owner.monthIndex + 1];
  const monthName = getMonthLabel(monthDate);
  return {
    monthPathSegments,
    month: ensureBuilder(
      root,
      buildPathSegments(monthPathSegments),
      owner.year === now.getFullYear() ? monthName : `${monthName} ${owner.year}`,
      "month",
      monthRank,
      monthRange.rangeStartMs,
      monthRange.rangeEndMs
    ),
  };
};

const addNoteToCalendar = (
  root: FeedNodeBuilder,
  note: NoteEntry,
  timestampMs: number,
  date: Date,
  now: Date
) => {
  const weekStart = getIsoWeekStart(date);
  const owner = pickWeekOwnerMonth(getWeekOwnerMonths(weekStart), date);
  const { month, monthPathSegments } = ensureCalendarMonth(root, owner, now);

  // Weeks are keyed by ISO number: unique within an owner month, and stable if
  // the ownership policy changes.
  const weekPathSegments = [
    ...monthPathSegments,
    "week",
    getIsoWeekNumber(weekStart),
  ];
  const weekRange = getWeekRange(weekStart, now);
  const weekNode = ensureBuilder(
    month,
    buildPathSegments(weekPathSegments),
    getWeekLabel(weekStart),
    "week",
    getChronologicalRank(weekRange.rangeStartMs),
    weekRange.rangeStartMs,
    weekRange.rangeEndMs
  );
  addNoteToDay(weekNode, weekPathSegments, note, timestampMs, date, now);
};

export const isCurrentWeekFeedNode = (node: Pick<FeedTreeNode, "id">) =>
  node.id.startsWith("feed:this-week:day:");

// Calendar buckets remain demand-driven. The seven current-week days are the
// intentional exception: they are pseudo-folders and remain visible when
// empty, matching the calendar-like navigation the section promises.
const shouldKeepNode = (node: FeedTreeNode) =>
  node.noteCount > 0 || isCurrentWeekFeedNode(node);

const finalizeBuilder = (builder: FeedNodeBuilder): FeedTreeNode => {
  const children = [...builder.children.values()]
    .map((child) => finalizeBuilder(child))
    .filter(shouldKeepNode)
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
    secondaryName: builder.secondaryName,
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

const currentWeekDaySegments = (date: Date) => [
  "this-week",
  "day",
  date.getFullYear(),
  date.getMonth() + 1,
  date.getDate(),
];

const ensureCurrentWeekDays = (
  root: FeedNodeBuilder,
  now: Date,
  bounds: FeedBoundaries
) => {
  const weekStart = new Date(bounds.thisWeekStartMs);
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const date = addDays(weekStart, dayOffset);
    const dayRange = getDayRange(date, now);
    ensureBuilder(
      root,
      buildPathSegments(currentWeekDaySegments(date)),
      getWeekdayName(date),
      "day",
      dayOffset,
      dayRange.rangeStartMs,
      dayRange.rangeEndMs
    );
  }
};

// Routes one dated note into exactly one half. The current Monday–Sunday week
// goes to its day pseudo-folder; anything older goes through month → week → day.
const addDatedNote = (
  root: FeedNodeBuilder,
  note: NoteEntry,
  timestampMs: number,
  now: Date,
  bounds: FeedBoundaries
) => {
  const date = new Date(timestampMs);

  if (
    timestampMs >= bounds.thisWeekStartMs &&
    timestampMs < bounds.nextWeekStartMs
  ) {
    const day = root.children.get(buildPathSegments(currentWeekDaySegments(date)));
    if (day) {
      addNoteToBuilder(day, note, timestampMs);
    }
    return;
  }
  addNoteToCalendar(root, note, timestampMs, date, now);
};

export function buildFeedTree(
  notes: NoteEntry[],
  previews: Record<string, NotePreview>,
  filter: FeedNoteFilter | boolean
): FeedTreeBuildResult {
  const now = new Date();
  const bounds = getFeedBoundaries(now);
  // The boolean form keeps compatibility with the old "hide archived" setting.
  const resolvedFilter =
    typeof filter === "boolean" ? (filter ? "active" : "all") : filter;
  const root = createBuilder("feed:root", "Feed", "special", null, 0);
  ensureCurrentWeekDays(root, now, bounds);

  notes.forEach((note) => {
    const preview = previews[note.path];
    if (!preview) {
      return;
    }
    if (!matchesFeedFilter(preview, resolvedFilter)) {
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
    addDatedNote(root, note, timestampMs, now, bounds);
  });

  const treeData = [...root.children.values()]
    .map((child) => finalizeBuilder(child))
    .filter(shouldKeepNode)
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
  const nowMs = Date.now();
  const today = treeData.find(
    (node) =>
      isCurrentWeekFeedNode(node) &&
      node.rangeStartMs != null &&
      node.rangeEndMs != null &&
      nowMs >= node.rangeStartMs &&
      nowMs <= node.rangeEndMs
  );
  return today?.id ?? treeData[0]?.id ?? "";
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
