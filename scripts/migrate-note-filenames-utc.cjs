#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const UUID_V7_FILE_NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}\.md$/i;
const UTC_TIMESTAMP_FILE_NAME_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)(?:-(.+))?\.md$/i;

function parseArgs(argv) {
  const args = {
    root: "/Users/digital/Projects/type/app/notes",
    apply: false,
    placeholderOnly: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--apply") {
      args.apply = true;
      continue;
    }
    if (token === "--placeholder-only") {
      args.placeholderOnly = true;
      continue;
    }
    if (token === "--root" && argv[i + 1]) {
      args.root = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function walkMarkdown(root, dir = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === ".migration-backups") {
        continue;
      }
      walkMarkdown(root, full, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function parseFrontMatter(raw) {
  if (!raw.startsWith("---\n")) {
    return { hasFrontMatter: false, meta: {}, body: raw };
  }
  const close = raw.indexOf("\n---\n", 4);
  if (close === -1) {
    return { hasFrontMatter: false, meta: {}, body: raw };
  }
  const header = raw.slice(4, close).split(/\r?\n/);
  const meta = {};
  for (const line of header) {
    const match = line.match(/^\s*([^:]+):\s*(.*)\s*$/);
    if (!match) {
      continue;
    }
    meta[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return { hasFrontMatter: true, meta, body: raw.slice(close + 5) };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function utcFilenamePrefix(timestampMs) {
  const d = new Date(timestampMs);
  const valid = Number.isFinite(d.getTime()) ? d : new Date(0);
  return `${valid.getUTCFullYear()}-${pad2(valid.getUTCMonth() + 1)}-${pad2(
    valid.getUTCDate()
  )}T${pad2(valid.getUTCHours())}-${pad2(valid.getUTCMinutes())}-${pad2(
    valid.getUTCSeconds()
  )}Z`;
}

function stripNoiseTokenSequences(tokens) {
  const cleaned = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (
      i + 3 < tokens.length &&
      tokens[i] === "nv" &&
      tokens[i + 1] === "empty" &&
      tokens[i + 2] === "line" &&
      tokens[i + 3] === "token"
    ) {
      i += 3;
      if (i + 1 < tokens.length && /^[a-z0-9]{1,32}$/i.test(tokens[i + 1])) {
        i += 1;
      }
      continue;
    }
    cleaned.push(tokens[i]);
  }
  return cleaned;
}

function isPlaceholderFileName(fileName) {
  if (UUID_V7_FILE_NAME_RE.test(fileName)) {
    return true;
  }
  const timestampMatch = fileName.match(UTC_TIMESTAMP_FILE_NAME_RE);
  if (!timestampMatch) {
    return false;
  }
  const suffix = (timestampMatch[2] || "").toLowerCase();
  return (
    !suffix ||
    suffix === "note" ||
    suffix === "untitled" ||
    /^note-[0-9a-f-]{8,}$/i.test(suffix)
  );
}

function buildSlug(body, fallback) {
  const cleaned = body
    .replace(/NV_EMPTY_LINE_TOKEN_[A-Za-z0-9]+/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+]\([^)]+\)/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[>\-*+]\s+/gm, "")
    .replace(/[_*~]/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return fallback;
  }
  const tokens = cleaned
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word && !word.startsWith("http") && !word.startsWith("www"));
  const words = stripNoiseTokenSequences(tokens).slice(0, 8);
  const slug = words.join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!slug) {
    return fallback;
  }
  return slug.slice(0, 56).replace(/-$/g, "");
}

function readJsonOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function copyWithParents(from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(args.root);
  if (!exists(root)) {
    throw new Error(`Root does not exist: ${root}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(root, ".migration-backups", `utc-filenames-${stamp}`);

  const notes = walkMarkdown(root).map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf8");
    const stat = fs.statSync(filePath);
    const parsed = parseFrontMatter(raw);
    const createdMs = Number(parsed.meta.created_ms);
    const updatedMs = Number(parsed.meta.updated_ms);
    const effectiveTimestamp =
      (Number.isFinite(createdMs) && createdMs > 0 ? createdMs : null) ||
      (Number.isFinite(updatedMs) && updatedMs > 0 ? updatedMs : null) ||
      Math.floor(stat.mtimeMs) ||
      0;
    const fallback = parsed.meta.type === "audio_recording" ? "recording" : "note";
    return {
      filePath,
      relPath: path.relative(root, filePath),
      dir: path.dirname(filePath),
      oldName: path.basename(filePath),
      body: parsed.body,
      effectiveTimestamp,
      slug: buildSlug(parsed.body, fallback),
    };
  });

  const folderEntries = new Map();
  for (const note of notes) {
    if (!folderEntries.has(note.dir)) {
      folderEntries.set(note.dir, []);
    }
    folderEntries.get(note.dir).push(note);
  }

  const renamePlan = [];
  const renameMapByFolder = new Map();

  for (const [folder, entries] of folderEntries.entries()) {
    const occupied = new Set(entries.map((entry) => entry.oldName.toLowerCase()));
    for (const entry of entries) {
      if (args.placeholderOnly && !isPlaceholderFileName(entry.oldName)) {
        continue;
      }
      occupied.delete(entry.oldName.toLowerCase());
      const prefix = utcFilenamePrefix(entry.effectiveTimestamp);
      const base = `${prefix}-${entry.slug || "note"}`;
      let candidate = `${base}.md`;
      let suffix = 2;
      while (
        occupied.has(candidate.toLowerCase()) ||
        (exists(path.join(folder, candidate)) &&
          candidate.toLowerCase() !== entry.oldName.toLowerCase())
      ) {
        candidate = `${base}-${suffix}.md`;
        suffix += 1;
      }
      occupied.add(candidate.toLowerCase());
      if (candidate === entry.oldName) {
        continue;
      }
      renamePlan.push({
        from: entry.filePath,
        to: path.join(folder, candidate),
        relFrom: entry.relPath,
        relTo: path.relative(root, path.join(folder, candidate)),
        folder,
        oldName: entry.oldName,
        newName: candidate,
      });
      if (!renameMapByFolder.has(folder)) {
        renameMapByFolder.set(folder, new Map());
      }
      renameMapByFolder.get(folder).set(entry.oldName, candidate);
    }
  }

  const orderFiles = [];
  for (const [folder, renameMap] of renameMapByFolder.entries()) {
    const orderPath = path.join(folder, ".notes-order.json");
    if (!exists(orderPath)) {
      continue;
    }
    const parsed = readJsonOrNull(orderPath);
    if (!parsed || !Array.isArray(parsed.note_order)) {
      continue;
    }
    const nextOrder = [];
    const seen = new Set();
    for (const item of parsed.note_order) {
      const next = renameMap.get(item) || item;
      if (seen.has(next)) {
        continue;
      }
      seen.add(next);
      nextOrder.push(next);
    }
    parsed.note_order = nextOrder;
    orderFiles.push({ filePath: orderPath, relPath: path.relative(root, orderPath), json: parsed });
  }

  const summary = {
    root,
    apply: args.apply,
    placeholderOnly: args.placeholderOnly,
    backupDir,
    totalNotes: notes.length,
    renames: renamePlan.length,
    orderFilesUpdated: orderFiles.length,
    preview: renamePlan.slice(0, 25).map((item) => ({
      from: item.relFrom,
      to: item.relTo,
    })),
  };

  if (!args.apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  ensureDir(backupDir);

  for (const item of renamePlan) {
    const backupPath = path.join(backupDir, item.relFrom);
    if (!exists(backupPath)) {
      copyWithParents(item.from, backupPath);
    }
  }
  for (const order of orderFiles) {
    const backupPath = path.join(backupDir, order.relPath);
    if (!exists(backupPath)) {
      copyWithParents(order.filePath, backupPath);
    }
  }

  const tempMoves = [];
  for (let i = 0; i < renamePlan.length; i += 1) {
    const item = renamePlan[i];
    const tempPath = `${item.from}.__utc_rename_tmp_${i}`;
    fs.renameSync(item.from, tempPath);
    tempMoves.push({ tempPath, finalPath: item.to });
  }
  for (const move of tempMoves) {
    ensureDir(path.dirname(move.finalPath));
    fs.renameSync(move.tempPath, move.finalPath);
  }

  for (const order of orderFiles) {
    fs.writeFileSync(order.filePath, `${JSON.stringify(order.json, null, 2)}\n`, "utf8");
  }

  const summaryPath = path.join(backupDir, "summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main();
