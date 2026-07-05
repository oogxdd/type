// Terminal-style folder matching for the command palette's `mv` command.
//
// The goal is a shell-like experience: `mv pe` searches every folder by name,
// `mv personal/` drills into a folder's children, and Tab completes the path so
// you can keep navigating deeper. Everything here is pure so it can be unit
// tested without the React/cmdk shell.

export type FolderSuggestion = {
  /** Full folder path relative to the notes root, e.g. "Personal/Body/Health". */
  path: string;
  /** Last path segment, e.g. "Health". */
  name: string;
  /** Parent path, "" for a root-level folder. */
  parent: string;
};

/** The keyword(s) that put the palette into move mode, followed by a space. */
const MOVE_PATTERN = /^\s*(mv|move)\s(.*)$/i;

export type ParsedMoveCommand = {
  /** The folder query typed after `mv ` (may be empty, may contain "/"). */
  query: string;
};

/**
 * Detect the `mv `/`move ` terminal command. Returns null when the input is not
 * (yet) a move command, so the palette falls back to its normal command list.
 * A trailing space after the keyword is required, so plain "mv" still surfaces
 * the discoverable "Move…" command instead of hijacking the input.
 */
export function parseMoveCommand(input: string): ParsedMoveCommand | null {
  const match = input.match(MOVE_PATTERN);
  if (!match) {
    return null;
  }
  return { query: match[2] };
}

const lastSegment = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const parentOf = (path: string) => {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
};

const toSuggestion = (path: string): FolderSuggestion => ({
  path,
  name: lastSegment(path),
  parent: parentOf(path),
});

/** Is `query` a subsequence of `text`? (fuzzy "prsnl" → "personal"). */
function isSubsequence(text: string, query: string): boolean {
  let cursor = 0;
  for (const char of text) {
    if (char === query[cursor]) {
      cursor += 1;
      if (cursor === query.length) {
        return true;
      }
    }
  }
  return cursor === query.length;
}

/** Direct children of `parent` ("" → root-level folders), case-insensitive. */
function directChildren(allPaths: string[], parent: string): string[] {
  const prefix = parent ? `${parent.toLowerCase()}/` : "";
  return allPaths.filter((path) => {
    const lower = path.toLowerCase();
    if (parent) {
      if (!lower.startsWith(prefix)) {
        return false;
      }
      const rest = path.slice(parent.length + 1);
      return rest.length > 0 && !rest.includes("/");
    }
    return path.length > 0 && !path.includes("/");
  });
}

/** Higher is a better name match; 0 means no match. */
function scoreName(name: string, fullPath: string, query: string): number {
  if (name === query) return 100;
  if (name.startsWith(query)) return 80;
  if (name.includes(query)) return 60;
  if (fullPath.includes(query)) return 40;
  if (isSubsequence(name, query)) return 20;
  return 0;
}

const MAX_SUGGESTIONS = 50;

const byPath = (a: FolderSuggestion, b: FolderSuggestion) =>
  a.path.localeCompare(b.path);

/**
 * Rank folders for a `mv` query.
 *
 * - empty query → all root-level folders
 * - query containing "/" → drill into the named parent and match its children
 *   (a trailing "/" lists every child of that folder)
 * - otherwise → fuzzy match every folder by its name, best first
 */
export function buildFolderSuggestions(
  allPaths: string[],
  query: string
): FolderSuggestion[] {
  const raw = query.replace(/^\/+/, "");

  if (raw === "") {
    return directChildren(allPaths, "").map(toSuggestion).sort(byPath).slice(0, MAX_SUGGESTIONS);
  }

  if (raw.includes("/")) {
    const splitAt = raw.lastIndexOf("/");
    const dirPart = raw.slice(0, splitAt);
    const namePart = raw.slice(splitAt + 1).toLowerCase();
    const resolvedDir = allPaths.find(
      (path) => path.toLowerCase() === dirPart.toLowerCase()
    );
    if (!resolvedDir) {
      return [];
    }
    const children = directChildren(allPaths, resolvedDir);
    const filtered =
      namePart === ""
        ? children
        : children.filter((path) => lastSegment(path).toLowerCase().includes(namePart));
    return filtered.map(toSuggestion).sort(byPath).slice(0, MAX_SUGGESTIONS);
  }

  const q = raw.toLowerCase();
  return allPaths
    .map((path) => ({
      path,
      score: scoreName(lastSegment(path).toLowerCase(), path.toLowerCase(), q),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => toSuggestion(entry.path));
}

/**
 * Does an existing folder exactly match the typed path? Used to decide whether
 * to offer a "create new folder" row.
 */
export function folderExists(allPaths: string[], query: string): boolean {
  const raw = query.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!raw) {
    return false;
  }
  return allPaths.some((path) => path.toLowerCase() === raw.toLowerCase());
}
