// System folder names inside every notes root. These mirror the Rust core's
// constants (crates/type-core) — including the intentional "Archieve" typo,
// which is persisted in user data and must not be fixed.
export const FEED_FOLDER_PATH = "Feed";
export const ARCHIEVE_FOLDER_PATH = "Archieve";
export const SYSTEM_FOLDER_PATHS = new Set([FEED_FOLDER_PATH, ARCHIEVE_FOLDER_PATH]);

export const isSystemFolder = (path: string) => SYSTEM_FOLDER_PATHS.has(path);
