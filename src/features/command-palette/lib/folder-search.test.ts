import { describe, expect, it } from "vitest";

import {
  buildFolderSuggestions,
  folderExists,
  parseMoveCommand,
} from "./folder-search";

const FOLDERS = [
  "Feed",
  "Archieve",
  "Personal",
  "Personal/Body",
  "Personal/Body/Health",
  "Personal/Mental",
  "Personal/Mental/Health",
  "Projects",
  "Projects/project_x",
  "Projects/project_x/design",
  "Projects/project_x/design/hud",
];

const paths = (suggestions: ReturnType<typeof buildFolderSuggestions>) =>
  suggestions.map((entry) => entry.path);

describe("parseMoveCommand", () => {
  it("requires a space after the keyword", () => {
    expect(parseMoveCommand("mv")).toBeNull();
    expect(parseMoveCommand("move")).toBeNull();
    expect(parseMoveCommand("new note")).toBeNull();
  });

  it("captures the query after mv/move", () => {
    expect(parseMoveCommand("mv ")).toEqual({ query: "" });
    expect(parseMoveCommand("mv personal")).toEqual({ query: "personal" });
    expect(parseMoveCommand("MOVE Projects/project_x")).toEqual({
      query: "Projects/project_x",
    });
  });
});

describe("buildFolderSuggestions", () => {
  it("lists root-level folders for an empty query", () => {
    expect(paths(buildFolderSuggestions(FOLDERS, ""))).toEqual([
      "Archieve",
      "Feed",
      "Personal",
      "Projects",
    ]);
  });

  it("fuzzy-matches every folder by name", () => {
    // "pe" → Personal (root-level startsWith wins)
    expect(paths(buildFolderSuggestions(FOLDERS, "pe"))[0]).toBe("Personal");
  });

  it("finds nested folders by their leaf name", () => {
    expect(paths(buildFolderSuggestions(FOLDERS, "Health"))).toEqual([
      "Personal/Body/Health",
      "Personal/Mental/Health",
    ]);
  });

  it("drills into children when the query has a trailing slash", () => {
    expect(paths(buildFolderSuggestions(FOLDERS, "Personal/"))).toEqual([
      "Personal/Body",
      "Personal/Mental",
    ]);
  });

  it("is case-insensitive when resolving the parent", () => {
    expect(paths(buildFolderSuggestions(FOLDERS, "personal/"))).toEqual([
      "Personal/Body",
      "Personal/Mental",
    ]);
  });

  it("filters children by the segment after the last slash", () => {
    expect(paths(buildFolderSuggestions(FOLDERS, "Personal/me"))).toEqual([
      "Personal/Mental",
    ]);
  });

  it("returns nothing when the parent path does not exist", () => {
    expect(buildFolderSuggestions(FOLDERS, "Nope/")).toEqual([]);
  });

  it("ignores a leading slash", () => {
    expect(paths(buildFolderSuggestions(FOLDERS, "/personal/"))).toEqual([
      "Personal/Body",
      "Personal/Mental",
    ]);
  });
});

describe("folderExists", () => {
  it("matches an existing folder case-insensitively, ignoring slashes", () => {
    expect(folderExists(FOLDERS, "personal/body")).toBe(true);
    expect(folderExists(FOLDERS, "/Personal/Body/")).toBe(true);
  });

  it("returns false for new paths", () => {
    expect(folderExists(FOLDERS, "Projects/project_x/design/hud/new")).toBe(false);
    expect(folderExists(FOLDERS, "")).toBe(false);
  });
});
