#!/usr/bin/env node
// Finds (and optionally deletes) audio files under a notes root's
// _system/_recordings/ folder that no note's front matter references anymore. These accumulate
// from notes deleted before NotesService::delete_items (see
// crates/type-core/src/application/notes.rs) started cascading to their
// linked audio file, or from any other manual cleanup of a recording note.
//
// Usage:
//   node scripts/cleanup-orphan-recordings.mjs <notes-root>            (dry run, lists orphans)
//   node scripts/cleanup-orphan-recordings.mjs <notes-root> --delete   (actually deletes them)
//
// <notes-root> is a profile's notes root folder (the one containing _system/,
// .type/, and the user's own folders) — not the app-data directory.
//
// Safe to run repeatedly, and safe with encryption on: only the note body is
// encrypted, front matter (including recording_audio_path) is always
// plaintext on disk.

import { readFileSync, readdirSync } from "node:fs";
import { unlinkSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";

// Storage folders hold media, never notes. Matched per path segment so a root
// that predates the `_system` layout (see scripts/migrate-notes-root-layout.mjs)
// is still walked correctly.
const STORAGE_FOLDERS = new Set([
  "_recordings", "_handwriting", "_attachments",
  "Attachments", "Recordings", "_Recordings",
]);
const RECORDINGS_STORAGE_FOLDER = "_system/_recordings";
// Word-level transcript sidecar next to an audio file, e.g.
// audio-xxxx.webm -> audio-xxxx.transcription.json (see
// save_word_level_json in adapters/recordings/whisper.rs). It shares the
// audio file's stem but is never itself named in front matter, so orphan
// detection must key off stems, not exact paths.
const TRANSCRIPTION_JSON_SUFFIX = ".transcription.json";

// Basename without its recognized suffix, used to associate a recording's
// sidecar files with the audio file referenced in front matter.
function fileStem(filePath) {
  const name = basename(filePath);
  if (name.endsWith(TRANSCRIPTION_JSON_SUFFIX)) {
    return name.slice(0, -TRANSCRIPTION_JSON_SUFFIX.length);
  }
  return basename(name, extname(name));
}

function collectMarkdownFiles(root, dir, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".notes-order.json") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      if (STORAGE_FOLDERS.has(entry.name)) continue;
      collectMarkdownFiles(root, full, files);
      continue;
    }
    if (entry.isFile() && extname(entry.name) === ".md") files.push(full);
  }
}

function collectFiles(dir, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, files);
      continue;
    }
    if (entry.isFile()) files.push(full);
  }
}

// Front matter is a `---`-delimited YAML-ish block at the very top of the
// file (see adapters/notes/front_matter.rs); body encryption never touches it.
function extractRecordingAudioPath(raw) {
  if (!raw.startsWith("---")) return null;
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return null;
  const frontmatter = raw.slice(0, end);
  const match = frontmatter.match(/^recording_audio_path:\s*(.+)$/m);
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function main() {
  const args = process.argv.slice(2);
  const shouldDelete = args.includes("--delete");
  const notesRoot = args.find((arg) => !arg.startsWith("--"));
  if (!notesRoot) {
    console.error("Usage: node scripts/cleanup-orphan-recordings.mjs <notes-root> [--delete]");
    process.exit(1);
  }

  const recordingsDir = join(notesRoot, RECORDINGS_STORAGE_FOLDER);
  const audioFiles = [];
  try {
    collectFiles(recordingsDir, audioFiles);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log(`No Recordings folder at ${recordingsDir} — nothing to do.`);
      return;
    }
    throw err;
  }

  const noteFiles = [];
  collectMarkdownFiles(notesRoot, notesRoot, noteFiles);

  const referencedStems = new Set();
  for (const notePath of noteFiles) {
    let raw;
    try {
      raw = readFileSync(notePath, "utf8");
    } catch {
      continue;
    }
    const audioRel = extractRecordingAudioPath(raw);
    if (!audioRel) continue;
    referencedStems.add(fileStem(audioRel.replace(/\\/g, "/")));
  }

  const orphans = audioFiles.filter((file) => !referencedStems.has(fileStem(file)));

  if (orphans.length === 0) {
    console.log("No orphaned recordings found.");
    return;
  }

  console.log(`${orphans.length} orphaned recording(s) under ${recordingsDir}:`);
  for (const file of orphans) {
    console.log(`  ${relative(notesRoot, file)}`);
  }

  if (shouldDelete) {
    for (const file of orphans) {
      unlinkSync(file);
    }
    console.log(`Deleted ${orphans.length} orphaned recording(s).`);
  } else {
    console.log("\nDry run only — rerun with --delete to remove these files.");
  }
}

main();
