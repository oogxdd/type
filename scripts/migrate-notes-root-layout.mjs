#!/usr/bin/env node
// Moves a notes root from the flat system-folder layout to the `_system` one.
//
//   before                       after
//   ------                       -----
//   Feed/                        _system/stream/
//   Archieve/                    _system/archive/
//   Recordings/                  _system/_recordings/
//   Attachments/                 _system/_handwriting/
//   Unsorted/    (legacy)        _system/stream/
//   _Recordings/ (legacy)        _system/_recordings/
//   <user folders>/              <user folders>/     (untouched)
//                                _system/agent/      (new, empty)
//                                _system/me/         (new, empty)
//                                _system/_attachments/ (new, empty)
//
// Recording and handwriting notes name their media file in front matter, so
// moving the folders is only half the job — the `recording_audio_path` and
// `handwriting_attachment_path` values are rewritten to match. Note bodies are
// never touched, which is also why this is safe with encryption on: front
// matter is plaintext on disk even when the body is not.
//
// Usage:
//   node scripts/migrate-notes-root-layout.mjs <notes-root>           (dry run)
//   node scripts/migrate-notes-root-layout.mjs <notes-root> --apply   (do it)
//
// <notes-root> is a profile's notes root — the folder that contains Feed/,
// Archieve/, .type/, … — not the app-data directory. Re-running after a
// successful migration is a no-op.
//
// See docs/FOLDER_STRUCTURE_MIGRATION.md for the full procedure, including
// what to do about git sync and the phone.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

const SYSTEM = "_system";

/** Old folder → new folder. Order matters: legacy names merge into the same targets. */
const MOVES = [
  ["Feed", "_system/stream"],
  ["Unsorted", "_system/stream"],
  ["Archieve", "_system/archive"],
  ["Recordings", "_system/_recordings"],
  ["_Recordings", "_system/_recordings"],
  ["Attachments", "_system/_handwriting"],
];

/** Created empty if missing, so the app finds the layout it expects. */
const REQUIRED = [
  "_system/stream",
  "_system/archive",
  "_system/agent",
  "_system/me",
  "_system/_attachments",
  "_system/_handwriting",
  "_system/_recordings",
];

/** Front-matter path prefixes to rewrite, longest-first so `_Recordings` wins over `Recordings`. */
const PATH_REWRITES = [
  ["_Recordings/", "_system/_recordings/"],
  ["Recordings/", "_system/_recordings/"],
  ["Attachments/", "_system/_handwriting/"],
];

const MEDIA_KEYS = ["recording_audio_path", "handwriting_attachment_path"];

const root = process.argv[2];
const apply = process.argv.includes("--apply");

if (!root) {
  console.error("Usage: node scripts/migrate-notes-root-layout.mjs <notes-root> [--apply]");
  process.exit(2);
}
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`Not a directory: ${root}`);
  process.exit(2);
}

const plan = [];
const problems = [];
const say = (line) => plan.push(line);

// A dry run must describe the same sequence an --apply run performs, so the
// plan tracks the filesystem it would have produced rather than the one on
// disk: `Recordings/` and the legacy `_Recordings/` land in the same place,
// and a folder a move just created is not "created" again afterwards.
const added = new Set();
const gone = new Set();
const here = (abs) => (added.has(abs) ? true : gone.has(abs) ? false : existsSync(abs));
const trackMove = (fromAbs, toAbs) => {
  gone.add(fromAbs);
  added.delete(fromAbs);
  added.add(toAbs);
  gone.delete(toAbs);
};

// ── Guard: an unrelated `_system` folder ──────────────────────────────────────
// Ours only ever contains the folders listed above. Anything else means the
// user already had a folder by that name, and merging into it would be wrong.
const systemPath = join(root, SYSTEM);
if (existsSync(systemPath)) {
  const known = new Set(REQUIRED.map((path) => path.slice(SYSTEM.length + 1)));
  const strangers = readdirSync(systemPath).filter(
    (name) => !name.startsWith(".") && !known.has(name)
  );
  if (strangers.length > 0) {
    console.error(
      `"${SYSTEM}" already exists in this notes root and holds entries the app does not own:\n` +
        strangers.map((name) => `  ${SYSTEM}/${name}`).join("\n") +
        `\nRename that folder first, then re-run.`
    );
    process.exit(1);
  }
}

// ── Step 1: move the system folders ───────────────────────────────────────────

/** Move every entry of `from` into `to`, refusing to overwrite. Returns moved count. */
const mergeInto = (fromAbs, toAbs, label) => {
  let moved = 0;
  for (const name of readdirSync(fromAbs)) {
    const source = join(fromAbs, name);
    const target = join(toAbs, name);
    if (existsSync(target)) {
      problems.push(`${label}: "${name}" exists in both — left in place, move it by hand`);
      continue;
    }
    if (apply) {
      renameSync(source, target);
    }
    moved += 1;
  }
  return moved;
};

for (const [from, to] of MOVES) {
  const fromAbs = join(root, from);
  if (!here(fromAbs) || !statSync(fromAbs).isDirectory()) {
    continue;
  }
  const toAbs = join(root, to);
  if (!here(toAbs)) {
    if (apply) {
      mkdirSync(join(root, SYSTEM), { recursive: true });
      renameSync(fromAbs, toAbs);
    }
    trackMove(fromAbs, toAbs);
    say(`move   ${from}/ -> ${to}/`);
    continue;
  }
  // The target already exists (a second legacy name, or a half-finished run):
  // merge entry by entry so nothing is clobbered.
  const moved = mergeInto(fromAbs, toAbs, from);
  trackMove(fromAbs, toAbs);
  say(`merge  ${from}/ -> ${to}/  (${moved} entr${moved === 1 ? "y" : "ies"})`);
  if (apply) {
    try {
      rmdirSync(fromAbs);
    } catch {
      problems.push(`${from}/ is not empty — check what is left in it`);
    }
  }
}

// ── Step 2: create the folders the new layout adds ────────────────────────────

for (const folder of REQUIRED) {
  const abs = join(root, folder);
  if (here(abs)) {
    continue;
  }
  if (apply) {
    mkdirSync(abs, { recursive: true });
  }
  added.add(abs);
  say(`create ${folder}/`);
}

// ── Step 3: repoint media paths in front matter ───────────────────────────────

const markdownFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      markdownFiles.push(abs);
    }
  }
};
walk(root);

/** Rewrite the two media keys inside a note's `---` front-matter block only. */
const rewriteFrontMatter = (raw) => {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return null;
  }
  const close = normalized.indexOf("\n---\n", 4);
  if (close === -1) {
    return null;
  }
  const header = normalized.slice(4, close);
  const rest = normalized.slice(close);
  let changed = false;
  const rewritten = header
    .split("\n")
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator === -1) {
        return line;
      }
      const key = line.slice(0, separator).trim().toLowerCase();
      if (!MEDIA_KEYS.includes(key)) {
        return line;
      }
      // Keep whatever quoting the core wrote; only the value's prefix moves.
      const value = line.slice(separator + 1);
      for (const [from, to] of PATH_REWRITES) {
        const quoted = value.trimStart();
        const lead = value.length - quoted.length;
        const unquoted = quoted.replace(/^["']|["']$/g, "");
        if (!unquoted.startsWith(from)) {
          continue;
        }
        const next = to + unquoted.slice(from.length);
        const quote = quoted.startsWith('"') ? '"' : quoted.startsWith("'") ? "'" : "";
        changed = true;
        return `${line.slice(0, separator)}:${" ".repeat(lead)}${quote}${next}${quote}`;
      }
      return line;
    })
    .join("\n");
  return changed ? `---\n${rewritten}${rest}` : null;
};

let rewrittenNotes = 0;
for (const file of markdownFiles) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    problems.push(`could not read ${relative(root, file)}: ${error.message}`);
    continue;
  }
  const next = rewriteFrontMatter(raw);
  if (next === null) {
    continue;
  }
  if (apply) {
    writeFileSync(file, next, "utf8");
  }
  rewrittenNotes += 1;
}
if (rewrittenNotes > 0) {
  say(`rewrite media paths in ${rewrittenNotes} note(s)`);
}

// ── Step 4: drop the old system folders from the root order file ──────────────

const orderPath = join(root, ".notes-order.json");
if (existsSync(orderPath)) {
  try {
    const order = JSON.parse(readFileSync(orderPath, "utf8"));
    const stale = new Set(MOVES.map(([from]) => from));
    const folderOrder = (order.folder_order ?? []).filter((name) => !stale.has(name));
    if (folderOrder.length !== (order.folder_order ?? []).length) {
      if (apply) {
        writeFileSync(
          orderPath,
          `${JSON.stringify({ ...order, folder_order: folderOrder }, null, 2)}\n`,
          "utf8"
        );
      }
      say("clean  .notes-order.json (dropped the old system folder names)");
    }
  } catch (error) {
    problems.push(`could not update .notes-order.json: ${error.message}`);
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log(apply ? `Migrated ${root}` : `Dry run for ${root} (pass --apply to do it)`);
if (plan.length === 0) {
  console.log("  nothing to do — this notes root is already on the new layout");
} else {
  for (const line of plan) {
    console.log(`  ${line}`);
  }
}
if (problems.length > 0) {
  console.log("\nNeeds a look:");
  for (const line of problems) {
    console.log(`  ${line}`);
  }
  process.exit(1);
}
