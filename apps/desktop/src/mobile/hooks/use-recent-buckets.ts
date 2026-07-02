import { useMemo } from "react";
import type { NoteEntry } from "@typenotes/shared/types";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { DAY_MS } from "../types";

export type RecentBucket = {
  id: string;
  label: string;
  subtitle: string;
  notes: NoteEntry[];
  dayEndMs: number | null;
};

export function useRecentBuckets() {
  const { allNotes, allNotePreviews } = useNotesTree();

  const recentBuckets = useMemo(() => {
    if (allNotes.length > 0 && Object.keys(allNotePreviews).length === 0) {
      return [] as RecentBucket[];
    }

    const groups = new Map<
      string,
      {
        dayStart: number;
        dayEnd: number;
        notes: Array<{ note: NoteEntry; updatedMs: number }>;
      }
    >();
    const undated: NoteEntry[] = [];

    allNotes.forEach((note) => {
      const preview = allNotePreviews[note.path];
      const updatedMs = preview?.updatedMs ?? null;
      if (!updatedMs) {
        undated.push(note);
        return;
      }
      const date = new Date(updatedMs);
      if (Number.isNaN(date.getTime())) {
        undated.push(note);
        return;
      }
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const dayEnd = dayStart + DAY_MS - 1;
      const dayKey = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
      const group = groups.get(dayKey);
      if (!group) {
        groups.set(dayKey, {
          dayStart,
          dayEnd,
          notes: [{ note, updatedMs }],
        });
      } else {
        group.notes.push({ note, updatedMs });
      }
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    const buckets: RecentBucket[] = Array.from(groups.entries())
      .sort(([, left], [, right]) => right.dayStart - left.dayStart)
      .map(([id, group]) => {
        const diffDays = Math.floor((todayStartMs - group.dayStart) / DAY_MS);
        const date = new Date(group.dayStart);
        const label =
          diffDays === 0
            ? "Today"
            : diffDays === 1
              ? "Yesterday"
              : date.toLocaleDateString([], {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                });
        const subtitle = date.toLocaleDateString([], {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const sortedNotes = [...group.notes]
          .sort((left, right) => right.updatedMs - left.updatedMs)
          .map((item) => item.note);
        return {
          id,
          label,
          subtitle,
          notes: sortedNotes,
          dayEndMs: group.dayEnd,
        };
      });

    if (undated.length > 0) {
      buckets.push({
        id: "undated",
        label: "Undated",
        subtitle: "No date metadata",
        notes: undated,
        dayEndMs: null,
      });
    }
    return buckets;
  }, [allNotePreviews, allNotes]);

  const recentBucketById = useMemo(
    () => new Map(recentBuckets.map((bucket) => [bucket.id, bucket] as const)),
    [recentBuckets]
  );

  return { recentBuckets, recentBucketById };
}
