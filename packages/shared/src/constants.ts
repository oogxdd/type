// System folder names inside every notes root. These mirror the Rust core's
// constants (crates/type-core/src/adapters/notes/mod.rs) and must stay in sync
// with them.
//
// Everything the app owns lives under one `_system` container, so a notes root
// contains nothing but `_system` and the user's own folders. `_system` itself
// is never browsable: shells drop it from the folder tree and reach `stream`
// (the UI's "Feed") and `archive` through their pinned entries. The core does
// not even put `_system/agent`, `_system/me` or the underscore-prefixed
// storage folders into the tree it returns.
export const SYSTEM_FOLDER_PATH = "_system";
export const STREAM_FOLDER_PATH = "_system/stream";
export const ARCHIVE_FOLDER_PATH = "_system/archive";
export const AGENT_FOLDER_PATH = "_system/agent";
export const ME_FOLDER_PATH = "_system/me";
export const REVIEWS_FOLDER_PATH = "_system/reviews";

export const SYSTEM_FOLDER_PATHS = new Set([
  SYSTEM_FOLDER_PATH,
  STREAM_FOLDER_PATH,
  ARCHIVE_FOLDER_PATH,
  AGENT_FOLDER_PATH,
  ME_FOLDER_PATH,
  REVIEWS_FOLDER_PATH,
]);

/** True for a folder the user cannot rename, move, delete or browse into. */
export const isSystemFolder = (path: string) => SYSTEM_FOLDER_PATHS.has(path);
