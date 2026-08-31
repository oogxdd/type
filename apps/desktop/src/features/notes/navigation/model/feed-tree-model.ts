import type { NoteEntry } from "@typenotes/shared/types";
import type { NotePreview } from "@typenotes/shared/format";
// The predicate lives in @typenotes/shared so the mobile feed filters by the
// same rules; re-exported here because this module is where the desktop's
// filter type has always been imported from.
import {
  matchesFeedFilter,
  type FeedNoteFilter,
} from "@typenotes/shared/note-filter";

export type { FeedNoteFilter };

// Feed is not the folder tree. It is a synthetic hierarchy built from note
// timestamps so the navigation UI can browse recent work by time bucket.
//
// Shape of the tree (today = Sun 9 Aug 2026, for example):
//
//   Today                                    <- relative half
//   Yesterday
//   This week            running ISO week minus today/yesterday
//   Last week            the whole previous ISO week (Mon-Sun)
//   July                                     <- calendar half
//     Week 30 · Jul 20 - 26
//     Week 29 · Jul 13 - 19
//       Monday 13
//       ...
//   2025
//     Q4 > December > Week 52 · Dec 22 - 28 > Monday 22
//   Undated
//
// Three rules hold the whole thing together; break one and the old pathologies
// (empty buckets, "Month start" stubs, a week cut in half by a month boundary)
// come back:
//
//   1. The two halves are separated by one instant, FeedBoundaries.
//      calendarCutoffMs, so a date is in exactly one of them. The calendar
//      never covers the last two weeks, so it can't grow buckets that are
//      empty by construction.
//   2. Weeks are ISO weeks, never clipped to a month (getWeekOwnerMonths
//      decides which month a straddling week hangs under).
//   3. Every level reads newest-first (getChronologicalRank).
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
};

// Intl is the hot path of this module: building the feed for thousands of
// notes used to spend seconds inside toLocaleDateString/localeCompare. Labels
// are deterministic per weekday/month/week, so they are cached, and one shared
// Collator replaces per-call localeCompare in the sorts.
const nameCollator = new Intl.Collator();
const compareNames = (left: string, right: string) => nameCollator.compare(left, right);

const WEEK_MS = 604_800_000;

// The feed has two halves and every note lands in exactly one of them, so no
// day is ever represented twice (see getFeedBoundaries):
//
//   relative half   Today / Yesterday / This week / Last week
//   calendar half   Month -> ISO week -> day   (Year -> Quarter -> ... if older)
//
// SPECIAL_GROUP_ORDER ranks the relative half; the calendar half is ranked by
// getChronologicalRank.
const SPECIAL_GROUP_ORDER: Record<string, number> = {
  today: 0,
  yesterday: 1,
  "this-week": 2,
  "last-week": 3,
  undated: 99_999,
};

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

const getWeekLabel = (weekStart: Date) => {
  const cacheKey = weekStart.getTime();
  const cached = weekLabelCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const weekEnd = addDays(weekStart, 6);
  const formatDay = (value: Date) =>
    value.toLocaleDateString([], { month: "short", day: "numeric" });
  const range =
    weekStart.getMonth() === weekEnd.getMonth()
      ? `${formatDay(weekStart)} - ${weekEnd.getDate()}`
      : `${formatDay(weekStart)} - ${formatDay(weekEnd)}`;
  const label = `Week ${getIsoWeekNumber(weekStart)} · ${range}`;
  weekLabelCache.set(cacheKey, label);
  return label;
};

type FeedBoundaries = {
  todayStartMs: number;
  yesterdayStartMs: number;
  thisWeekStartMs: number;
  /**
   * Start of the previous ISO week, and the seam between the feed's two halves:
   * at or after it a note goes to a relative bucket, before it to the calendar.
   * Because the seam is a single instant, the halves cannot overlap — which is
   * what keeps the calendar free of always-empty "the last few days" nodes.
   */
  calendarCutoffMs: number;
};

const getFeedBoundaries = (now: Date): FeedBoundaries => {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisWeekStart = getIsoWeekStart(todayStart);
  return {
    todayStartMs: todayStart.getTime(),
    yesterdayStartMs: addDays(todayStart, -1).getTime(),
    thisWeekStartMs: thisWeekStart.getTime(),
    calendarCutoffMs: addDays(thisWeekStart, -7).getTime(),
  };
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

// Day rows carry the day of month because an ISO week can span two months, so
// the weekday name alone no longer pins the date. Only the weekday name is
// cached (7 entries) — the number is appended, keeping this off the hot path.
const getDayLabel = (date: Date) => `${getWeekdayName(date)} ${date.getDate()}`;

const getSpecialLabel = (
  kind: "today" | "yesterday" | "this-week" | "last-week" | "undated"
) => {
  if (kind === "today") return "Today";
  if (kind === "yesterday") return "Yesterday";
  if (kind === "this-week") return "This week";
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
    getDayLabel(date),
    "day",
    getChronologicalRank(dayRange.rangeStartMs),
    dayRange.rangeStartMs,
    dayRange.rangeEndMs
  );
  addNoteToBuilder(dayNode, note, timestampMs);
};

// Months of the running year sit at the feed root; older ones keep the
// Year -> Quarter -> Month nesting. Note this is keyed off the month that OWNS
// the week, not off the note's own date — under the ISO ownership rule a note
// from Jan 1st can belong to a week owned by the previous December.
const ensureCalendarMonth = (
  root: FeedNodeBuilder,
  owner: MonthKey,
  now: Date
) => {
  const monthDate = new Date(owner.year, owner.monthIndex, 1);
  const monthRange = getMonthRange(monthDate, now);
  const monthRank = 10 + getMonthSortRank(monthDate);

  if (owner.year === now.getFullYear()) {
    const monthPathSegments = ["month", owner.year, owner.monthIndex + 1];
    return {
      monthPathSegments,
      month: ensureBuilder(
        root,
        buildPathSegments(monthPathSegments),
        getMonthLabel(monthDate),
        "month",
        monthRank,
        monthRange.rangeStartMs,
        monthRange.rangeEndMs
      ),
    };
  }

  const yearRange = getYearRange(monthDate, now);
  const year = ensureBuilder(
    root,
    buildPathSegments(["year", owner.year]),
    String(owner.year),
    "year",
    getYearSortRank(owner.year),
    yearRange.rangeStartMs,
    yearRange.rangeEndMs
  );
  const quarter = getQuarter(monthDate);
  const quarterRange = getQuarterRange(monthDate, now);
  const quarterNode = ensureBuilder(
    year,
    buildPathSegments(["year", owner.year, "quarter", quarter]),
    `Q${quarter}`,
    "quarter",
    getQuarterSortRank(quarter),
    quarterRange.rangeStartMs,
    quarterRange.rangeEndMs
  );
  const monthPathSegments = [
    "year",
    owner.year,
    "quarter",
    quarter,
    "month",
    owner.monthIndex + 1,
  ];
  return {
    monthPathSegments,
    month: ensureBuilder(
      quarterNode,
      buildPathSegments(monthPathSegments),
      getMonthLabel(monthDate),
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

// A bucket with no notes anywhere beneath it is never rendered. Nothing builds
// empty buckets today (there is no calendar skeleton — nodes are created on
// demand by the note that lands in them), so this filter is an invariant guard
// for future builders rather than live pruning.
//
// Consequence to keep in mind: date buckets double as back-dating targets —
// selecting one and typing creates a note stamped with
// getLatestFeedTargetTimestamp(node). With no empty buckets, only dates that
// already hold a note can be targeted that way.
const hasNotes = (node: FeedTreeNode) => node.noteCount > 0;

const finalizeBuilder = (builder: FeedNodeBuilder): FeedTreeNode => {
  const children = [...builder.children.values()]
    .map((child) => finalizeBuilder(child))
    .filter(hasNotes)
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

// Routes one dated note into exactly one bucket. The order of the checks below
// IS the definition of the feed's two halves: each branch consumes a slice of
// time, so a note that reaches the calendar is provably older than every
// relative bucket. Today/Yesterday are checked before the week buckets because
// on a Monday "yesterday" belongs to the previous ISO week.
const addDatedNote = (
  root: FeedNodeBuilder,
  note: NoteEntry,
  timestampMs: number,
  now: Date,
  bounds: FeedBoundaries
) => {
  const date = new Date(timestampMs);

  if (timestampMs >= bounds.todayStartMs) {
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

  if (timestampMs >= bounds.yesterdayStartMs) {
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

  // "This week" is the running ISO week minus today and yesterday, so it is
  // empty (and therefore absent) on Mondays and Tuesdays.
  if (timestampMs >= bounds.thisWeekStartMs) {
    const thisWeek = ensureBuilder(
      root,
      buildPathSegments(["this-week"]),
      getSpecialLabel("this-week"),
      "special",
      SPECIAL_GROUP_ORDER["this-week"],
      bounds.thisWeekStartMs,
      bounds.yesterdayStartMs - 1
    );
    addNoteToDay(thisWeek, ["this-week"], note, timestampMs, date, now);
    return;
  }

  // "Last week" is the whole previous ISO week (Monday–Sunday), not a rolling
  // seven-day window — minus yesterday when today is a Monday.
  if (timestampMs >= bounds.calendarCutoffMs) {
    const lastWeek = ensureBuilder(
      root,
      buildPathSegments(["last-week"]),
      getSpecialLabel("last-week"),
      "special",
      SPECIAL_GROUP_ORDER["last-week"],
      bounds.calendarCutoffMs,
      Math.min(bounds.thisWeekStartMs, bounds.yesterdayStartMs) - 1
    );
    addNoteToDay(lastWeek, ["last-week"], note, timestampMs, date, now);
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
    .filter(hasNotes)
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
