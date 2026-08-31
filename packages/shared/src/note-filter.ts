// Which notes a feed view shows. Shared so the desktop's filter chips and the
// phone's agree on what "archived" or "reviewed" means — both read the same
// front-matter markers through NotePreview.

import type { NotePreview } from "./format";

export type FeedNoteFilter =
  | "all"
  | "active"
  | "reviewed"
  | "unreviewed"
  | "archived";

export const matchesFeedFilter = (
  preview: NotePreview,
  filter: FeedNoteFilter
): boolean => {
  switch (filter) {
    case "active":
      return !preview.isArchived;
    case "reviewed":
      return preview.isReviewed;
    case "unreviewed":
      return !preview.isReviewed;
    case "archived":
      return preview.isArchived;
    default:
      return true;
  }
};
