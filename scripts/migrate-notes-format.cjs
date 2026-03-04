#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FRONTMATTER_KEYS_ORDER = [
  "id",
  "created_ms",
  "updated_ms",
  "type",
  "recording_audio_path",
  "transcription_status",
  "transcription_error",
  "transcription_updated_ms",
  "transcription_id",
];

const FEED = "Feed";
const LEGACY_UNSORTED = "Unsorted";
const ARCHIEVE = "Archieve";
const RECORDINGS = "Recordings";
const LEGACY_RECORDINGS = "_Recordings";
const ORDER_FILE = ".notes-order.json";

const TRANSCRIPT_START_MARKER = "<!-- recording-transcript:start -->";
const TRANSCRIPT_END_MARKER = "<!-- recording-transcript:end -->";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const args = {
    root: "/Users/digital/Projects/type/app/notes",
    apply: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--apply") {
      args.apply = true;
      continue;
    }
    if (current === "--root" && argv[i + 1]) {
      args.root = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function exists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(targetPath, apply) {
  if (exists(targetPath)) {
    return;
  }
  if (apply) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonPretty(filePath, data, apply) {
  if (!apply) {
    return;
  }
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function walkFiles(rootPath, predicate, out = []) {
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const full = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === ".migration-backups") {
        continue;
      }
      walkFiles(full, predicate, out);
      continue;
    }
    if (entry.isFile() && predicate(full, entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function parseFrontMatter(raw) {
  if (!raw.startsWith("---\n")) {
    return {
      hasFrontMatter: false,
      meta: {},
      passthrough: [],
      body: raw,
    };
  }
  const close = raw.indexOf("\n---\n", 4);
  if (close === -1) {
    return {
      hasFrontMatter: false,
      meta: {},
      passthrough: [],
      body: raw,
    };
  }
  const header = raw.slice(4, close).split(/\r?\n/);
  const meta = {};
  const passthrough = [];
  for (const line of header) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const m = line.match(/^\s*([^:]+):\s*(.*)\s*$/);
    if (!m) {
      passthrough.push(line);
      continue;
    }
    const key = m[1].trim();
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    meta[key] = value;
  }
  return {
    hasFrontMatter: true,
    meta,
    passthrough,
    body: raw.slice(close + 5),
  };
}

function safeFrontMatterValue(value) {
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : JSON.stringify(value);
}

function renderFrontMatter(meta, passthrough, body) {
  const lines = ["---"];
  for (const key of FRONTMATTER_KEYS_ORDER) {
    const value = meta[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    lines.push(`${key}: ${safeFrontMatterValue(String(value))}`);
  }
  for (const line of passthrough) {
    lines.push(line);
  }
  lines.push("---", "");
  return `${lines.join("\n")}${body}`;
}

function uuidV7(timestampMs = Date.now()) {
  const bytes = crypto.randomBytes(16);
  const timestamp = BigInt(timestampMs);
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
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

function textSlug(body, fallback) {
  const stripped = body
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
  if (!stripped) {
    return fallback;
  }
  const tokens = stripped
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word && !word.startsWith("http") && !word.startsWith("www"));
  const words = stripNoiseTokenSequences(tokens).slice(0, 8);
  const slug = words.join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return slug || fallback;
}

function uniqueFileName(dirPath, targetName, usedNamesLower, currentPath = null) {
  const ext = path.extname(targetName);
  const base = path.basename(targetName, ext);
  let candidate = targetName;
  let suffix = 2;
  while (true) {
    const candidatePath = path.join(dirPath, candidate);
    const candidateTakenBySet = usedNamesLower.has(candidate.toLowerCase());
    const candidateExistsOnDisk = exists(candidatePath);
    const sameAsCurrentPath =
      currentPath && path.resolve(candidatePath) === path.resolve(currentPath);
    if (!candidateTakenBySet && (!candidateExistsOnDisk || sameAsCurrentPath)) {
      break;
    }
    candidate = `${base}-${suffix}${ext}`;
    suffix += 1;
  }
  usedNamesLower.add(candidate.toLowerCase());
  return candidate;
}

function removeDirIfEmpty(dirPath, apply) {
  if (!exists(dirPath)) {
    return;
  }
  if (fs.readdirSync(dirPath).length > 0) {
    return;
  }
  if (apply) {
    fs.rmdirSync(dirPath);
  }
}

function backupPath(backupRoot, rootPath, absolutePath) {
  return path.join(backupRoot, path.relative(rootPath, absolutePath));
}

function copyDirRecursive(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
      continue;
    }
    if (entry.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

function updateOrderFileForRenames(orderFilePath, renameMap, apply) {
  if (!exists(orderFilePath)) {
    return false;
  }
  const data = readJsonSafe(orderFilePath, null);
  if (!data || !Array.isArray(data.note_order)) {
    return false;
  }
  const nextOrder = [];
  const seen = new Set();
  for (const item of data.note_order) {
    const updated = renameMap.get(item) || item;
    if (seen.has(updated)) {
      continue;
    }
    seen.add(updated);
    nextOrder.push(updated);
  }
  data.note_order = nextOrder;
  writeJsonPretty(orderFilePath, data, apply);
  return true;
}

function recordingStatusLabel(status) {
  if (status === "queued") return "Transcription is queued.";
  if (status === "processing") return "Transcription is processing.";
  if (status === "completed") return "Transcription completed.";
  if (status === "failed") return "Transcription failed.";
  return "Transcription is pending.";
}

function recordingTranscriptSection(status, errorText) {
  if (status === "failed") {
    const details = (errorText || "Unknown transcription error.").trim();
    return `## Transcript\n\n(Transcription failed.)\n\nError: ${details}\n`;
  }
  return `## Transcript\n\n(${recordingStatusLabel(status)})\n`;
}

function recordingBodyForStatus(status, errorText) {
  const section = recordingTranscriptSection(status, errorText).trim();
  return `# Recording\n\n${TRANSCRIPT_START_MARKER}\n\n${section}\n\n${TRANSCRIPT_END_MARKER}\n`;
}

function main() {
  const { root, apply } = parseArgs(process.argv);
  if (!exists(root)) {
    throw new Error(`Root does not exist: ${root}`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(root, ".migration-backups", `full-format-${stamp}`);
  const backedUp = new Set();
  const report = {
    root,
    apply,
    backupDir,
    movedUnsortedToFeed: false,
    movedLegacyRecordingsFiles: 0,
    updatedRecordingRefs: 0,
    renamedNotes: 0,
    updatedFrontMatter: 0,
    generatedUuidIds: 0,
    createdNotesFromLegacyRecordingFolders: 0,
    removedFeedOrderFile: false,
    removedLegacyFolders: [],
    touched: [],
  };

  function backupOnce(targetPath) {
    const absolute = path.resolve(targetPath);
    if (!exists(absolute) || backedUp.has(absolute)) {
      return;
    }
    const out = backupPath(backupDir, root, absolute);
    if (apply) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      if (fs.statSync(absolute).isDirectory()) {
        copyDirRecursive(absolute, out);
      } else {
        fs.copyFileSync(absolute, out);
      }
    }
    backedUp.add(absolute);
  }

  const feedPath = path.join(root, FEED);
  const unsortedPath = path.join(root, LEGACY_UNSORTED);
  ensureDir(feedPath, apply);
  ensureDir(path.join(root, RECORDINGS), apply);
  ensureDir(path.join(root, ARCHIEVE), apply);

  if (exists(unsortedPath)) {
    for (const entry of fs.readdirSync(unsortedPath, { withFileTypes: true })) {
      if (entry.name === ORDER_FILE) {
        continue;
      }
      const source = path.join(unsortedPath, entry.name);
      let target = path.join(feedPath, entry.name);
      if (exists(target)) {
        if (entry.isDirectory() && fs.statSync(target).isDirectory()) {
          for (const nested of fs.readdirSync(source)) {
            const nestedSource = path.join(source, nested);
            let nestedTarget = path.join(target, nested);
            let suffix = 2;
            while (exists(nestedTarget)) {
              nestedTarget = path.join(target, `${nested}-${suffix}`);
              suffix += 1;
            }
            if (apply) {
              backupOnce(nestedSource);
              fs.renameSync(nestedSource, nestedTarget);
            }
          }
          if (apply) {
            backupOnce(source);
            removeDirIfEmpty(source, true);
          }
          continue;
        }
        const parsed = path.parse(target);
        let suffix = 2;
        while (exists(target)) {
          target = path.join(parsed.dir, `${parsed.name}-${suffix}${parsed.ext}`);
          suffix += 1;
        }
      }
      if (apply) {
        backupOnce(source);
        fs.renameSync(source, target);
      }
    }
    if (apply) {
      backupOnce(unsortedPath);
      removeDirIfEmpty(unsortedPath, true);
    }
    report.movedUnsortedToFeed = true;
    report.removedLegacyFolders.push(LEGACY_UNSORTED);
  }

  const rootOrderPath = path.join(root, ORDER_FILE);
  if (exists(rootOrderPath)) {
    const rootOrder = readJsonSafe(rootOrderPath, null);
    if (rootOrder && Array.isArray(rootOrder.folder_order)) {
      const next = [];
      const seen = new Set();
      for (const name of rootOrder.folder_order) {
        const normalized = name === LEGACY_UNSORTED ? FEED : name;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        next.push(normalized);
      }
      if (!seen.has(FEED)) next.unshift(FEED);
      if (!seen.has(ARCHIEVE)) next.push(ARCHIEVE);
      rootOrder.folder_order = next;
      writeJsonPretty(rootOrderPath, rootOrder, apply);
      if (apply) report.touched.push(path.relative(root, rootOrderPath));
    }
  }

  const legacyRecPath = path.join(root, LEGACY_RECORDINGS);
  const recPath = path.join(root, RECORDINGS);
  const recordingPathMap = new Map();
  if (exists(legacyRecPath)) {
    const legacyAudioFiles = walkFiles(
      legacyRecPath,
      (_, name) => name.toLowerCase() !== ".ds_store"
    ).filter((file) => fs.statSync(file).isFile());
    for (const source of legacyAudioFiles) {
      const base = path.basename(source);
      let target = path.join(recPath, base);
      if (exists(target)) {
        const parsed = path.parse(base);
        let suffix = 2;
        while (exists(target)) {
          target = path.join(recPath, `${parsed.name}-${suffix}${parsed.ext}`);
          suffix += 1;
        }
      }
      const oldRel = path.relative(root, source).replace(/\\/g, "/");
      const newRel = path.relative(root, target).replace(/\\/g, "/");
      recordingPathMap.set(oldRel, newRel);
      if (apply) {
        backupOnce(source);
        fs.renameSync(source, target);
      }
      report.movedLegacyRecordingsFiles += 1;
    }
    if (apply) {
      backupOnce(legacyRecPath);
      fs.rmSync(legacyRecPath, { recursive: true, force: true });
      report.removedLegacyFolders.push(LEGACY_RECORDINGS);
    }
  }

  const noteFiles = walkFiles(root, (_, name) => name.endsWith(".md"));
  const usedNamesByFolder = new Map();
  for (const notePath of noteFiles) {
    const folder = path.dirname(notePath);
    if (!usedNamesByFolder.has(folder)) {
      usedNamesByFolder.set(folder, new Set());
    }
    usedNamesByFolder.get(folder).add(path.basename(notePath).toLowerCase());
  }
  const renameMapByFolder = new Map();

  for (const notePath of noteFiles) {
    const raw = fs.readFileSync(notePath, "utf8");
    const stat = fs.statSync(notePath);
    const parsed = parseFrontMatter(raw);
    const meta = { ...parsed.meta };
    const passthrough = [...parsed.passthrough];
    let metaChanged = false;
    let newId = meta.id;

    if (!newId || !UUID_V7_RE.test(newId)) {
      const seed = Number(meta.created_ms) || Number(meta.updated_ms) || Math.floor(stat.mtimeMs);
      newId = uuidV7(seed);
      meta.id = newId;
      metaChanged = true;
      report.generatedUuidIds += 1;
    }

    const createdMs = Number(meta.created_ms) || Math.floor(stat.mtimeMs);
    const updatedMs = Number(meta.updated_ms) || Math.max(createdMs, Math.floor(stat.mtimeMs));
    if (!Number(meta.created_ms)) {
      meta.created_ms = String(createdMs);
      metaChanged = true;
    }
    if (!Number(meta.updated_ms)) {
      meta.updated_ms = String(updatedMs);
      metaChanged = true;
    }

    if (meta.type === "audio_recording" && typeof meta.recording_audio_path === "string") {
      const normalized = meta.recording_audio_path.replace(/\\/g, "/");
      if (recordingPathMap.has(normalized)) {
        meta.recording_audio_path = recordingPathMap.get(normalized);
        metaChanged = true;
        report.updatedRecordingRefs += 1;
      } else if (normalized.startsWith("_Recordings/")) {
        meta.recording_audio_path = normalized.replace(/^_Recordings\//, "Recordings/");
        metaChanged = true;
        report.updatedRecordingRefs += 1;
      }
    }

    const folderPath = path.dirname(notePath);
    const oldName = path.basename(notePath);
    const oldLower = oldName.toLowerCase();
    const used = usedNamesByFolder.get(folderPath) || new Set();
    used.delete(oldLower);
    usedNamesByFolder.set(folderPath, used);

    const isRecording = meta.type === "audio_recording";
    const fallbackSlug = isRecording ? "recording" : "note";
    const slug = textSlug(parsed.body, fallbackSlug);
    const idPrefix = String(newId).slice(0, 13).toLowerCase();
    const targetName = `${idPrefix}-${slug}.md`;
    const finalName = uniqueFileName(folderPath, targetName, used, notePath);
    const finalPath = path.join(folderPath, finalName);
    const renamed = finalName !== oldName;

    if (renamed) {
      report.renamedNotes += 1;
      if (!renameMapByFolder.has(folderPath)) {
        renameMapByFolder.set(folderPath, new Map());
      }
      renameMapByFolder.get(folderPath).set(oldName, finalName);
    }

    if (metaChanged) {
      report.updatedFrontMatter += 1;
    }

    if (apply && (renamed || metaChanged)) {
      backupOnce(notePath);
      if (renamed) {
        fs.renameSync(notePath, finalPath);
      }
      if (metaChanged || !parsed.hasFrontMatter) {
        const nextRaw = renderFrontMatter(meta, passthrough, parsed.body);
        fs.writeFileSync(finalPath, nextRaw, "utf8");
      }
      report.touched.push(path.relative(root, finalPath));
    }
  }

  const legacyRecordingDirs = exists(recPath)
    ? fs
        .readdirSync(recPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^recording-\d+/.test(entry.name))
        .map((entry) => path.join(recPath, entry.name))
    : [];

  const feedUsedNames = usedNamesByFolder.get(feedPath) || new Set();
  usedNamesByFolder.set(feedPath, feedUsedNames);

  for (const dirPath of legacyRecordingDirs) {
    const name = path.basename(dirPath);
    const tsMatch = name.match(/^recording-(\d+)/);
    const dirTimestamp = tsMatch ? Number(tsMatch[1]) : null;
    const statusPath = path.join(dirPath, ".transcription-status.json");
    const statusJson = readJsonSafe(statusPath, {});
    const status = String(statusJson.status || "pending");
    const errorText = statusJson.error ? String(statusJson.error) : null;
    const updatedMs = Number(statusJson.updated_ms) || null;
    const transcriptId = statusJson.transcript_id ? String(statusJson.transcript_id) : null;
    const files = fs
      .readdirSync(dirPath)
      .filter((item) => item !== ".transcription-status.json");
    const audioName = files.find((item) => /\.(webm|m4a|mp3|wav|ogg|aac|mp4|flac)$/i.test(item));
    if (!audioName) {
      continue;
    }
    const audioSource = path.join(dirPath, audioName);
    const audioExt = path.extname(audioName) || ".webm";
    const createdMs =
      dirTimestamp || updatedMs || Math.floor(fs.statSync(audioSource).mtimeMs) || Date.now();
    const noteId = uuidV7(createdMs);
    let audioTargetName = `audio-${noteId}${audioExt.toLowerCase()}`;
    let audioTargetPath = path.join(recPath, audioTargetName);
    let audioSuffix = 2;
    while (exists(audioTargetPath)) {
      audioTargetName = `audio-${noteId}-${audioSuffix}${audioExt.toLowerCase()}`;
      audioTargetPath = path.join(recPath, audioTargetName);
      audioSuffix += 1;
    }
    const notePrefix = noteId.slice(0, 13).toLowerCase();
    const noteName = uniqueFileName(feedPath, `${notePrefix}-recording.md`, feedUsedNames);
    const notePath = path.join(feedPath, noteName);
    const relAudio = path.relative(root, audioTargetPath).replace(/\\/g, "/");
    const noteMeta = {
      id: noteId,
      created_ms: String(createdMs),
      updated_ms: String(updatedMs || createdMs),
      type: "audio_recording",
      recording_audio_path: relAudio,
      transcription_status: status,
      transcription_error: errorText || undefined,
      transcription_updated_ms: String(updatedMs || createdMs),
      transcription_id: transcriptId || undefined,
    };
    const noteBody = recordingBodyForStatus(status, errorText);

    if (apply) {
      backupOnce(dirPath);
      fs.renameSync(audioSource, audioTargetPath);
      fs.writeFileSync(notePath, renderFrontMatter(noteMeta, [], noteBody), "utf8");
      fs.rmSync(dirPath, { recursive: true, force: true });
      report.touched.push(path.relative(root, notePath));
      report.touched.push(path.relative(root, audioTargetPath));
    }
    report.createdNotesFromLegacyRecordingFolders += 1;
  }

  for (const [folderPath, renameMap] of renameMapByFolder.entries()) {
    const orderPath = path.join(folderPath, ORDER_FILE);
    if (!exists(orderPath)) {
      continue;
    }
    if (apply) {
      backupOnce(orderPath);
    }
    const changed = updateOrderFileForRenames(orderPath, renameMap, apply);
    if (changed && apply) {
      report.touched.push(path.relative(root, orderPath));
    }
  }

  const feedOrderPath = path.join(feedPath, ORDER_FILE);
  if (exists(feedOrderPath)) {
    if (apply) {
      backupOnce(feedOrderPath);
      fs.unlinkSync(feedOrderPath);
      report.touched.push(path.relative(root, feedOrderPath));
    }
    report.removedFeedOrderFile = true;
  }

  if (apply) {
    ensureDir(backupDir, true);
    fs.writeFileSync(
      path.join(backupDir, "summary.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    );
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
