export type SheetContext =
  | { type: "folder"; path: string }
  | { type: "note"; path: string };

export const FEED_FOLDER_PATH = "Feed";
export const ARCHIVE_FOLDER_PATH = "Archieve";
export const SYSTEM_FOLDER_PATHS = new Set(["Feed", "Archieve"]);
export const DAY_MS = 86_400_000;

export const getDisplayFolderName = (rawName: string) =>
  rawName === "Archieve" ? "Archive" : rawName;
export const getDisplayRouteTitle = (rawTitle: string) =>
  rawTitle === "Archieve" ? "Archive" : rawTitle;
