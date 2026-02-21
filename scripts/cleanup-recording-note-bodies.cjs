#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const START_MARKER = "<!-- recording-transcript:start -->";
const END_MARKER = "<!-- recording-transcript:end -->";

function parseArgs(argv) {
  const args = {
    root: "/Users/digital/Projects/type/app/notes",
    apply: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--apply") {
      args.apply = true;
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
    return { hasFrontMatter: false, meta: {}, prefix: "", body: raw };
  }
  const close = raw.indexOf("\n---\n", 4);
  if (close === -1) {
    return { hasFrontMatter: false, meta: {}, prefix: "", body: raw };
  }
  const header = raw.slice(4, close);
  const meta = {};
  for (const line of header.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]+):\s*(.*)\s*$/);
    if (!match) {
      continue;
    }
    meta[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return {
    hasFrontMatter: true,
    meta,
    prefix: raw.slice(0, close + 5),
    body: raw.slice(close + 5),
  };
}

function cleanTranscriptText(text) {
  const noiseLine = (line) => {
    const value = line.trim();
    if (!value) return true;
    return (
      /^#\s*recording$/i.test(value) ||
      /^##\s*transcript$/i.test(value) ||
      /^<!--\s*recording-transcript:(start|end)\s*-->$/i.test(value) ||
      /^\(transcription(?:\s+\w+)*\.\)$/i.test(value) ||
      /^error:\s*/i.test(value)
    );
  };

  const kept = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !noiseLine(line));
  const result = kept.join("\n").trim();
  return result ? `${result}\n` : "";
}

function betweenMarkers(body) {
  const normalized = body.replace(/\r\n/g, "\n");
  const start = normalized.indexOf(START_MARKER);
  if (start === -1) {
    return null;
  }
  const from = start + START_MARKER.length;
  const end = normalized.indexOf(END_MARKER, from);
  if (end === -1) {
    return null;
  }
  return normalized.slice(from, end);
}

function buildNextBody(meta, body) {
  const status = String(meta.transcription_status || "").trim().toLowerCase();
  if (status !== "completed") {
    return "";
  }

  const markerBody = betweenMarkers(body);
  const cleanedFromMarker = markerBody == null ? "" : cleanTranscriptText(markerBody);
  if (cleanedFromMarker) {
    return cleanedFromMarker;
  }
  return cleanTranscriptText(body);
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
  const backupDir = path.join(
    root,
    ".migration-backups",
    `cleanup-recording-bodies-${stamp}`
  );

  const plan = [];
  for (const filePath of walkMarkdown(root)) {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseFrontMatter(raw);
    if (!parsed.hasFrontMatter || parsed.meta.type !== "audio_recording") {
      continue;
    }
    const nextBody = buildNextBody(parsed.meta, parsed.body);
    const currentNormalized = parsed.body.replace(/\r\n/g, "\n").trim();
    const nextNormalized = nextBody.replace(/\r\n/g, "\n").trim();
    if (currentNormalized === nextNormalized) {
      continue;
    }
    plan.push({
      filePath,
      relPath: path.relative(root, filePath),
      nextRaw: `${parsed.prefix}${nextBody ? `\n${nextBody}` : ""}`,
    });
  }

  const summary = {
    root,
    apply: args.apply,
    backupDir,
    touched: plan.length,
    preview: plan.slice(0, 50).map((entry) => entry.relPath),
  };

  if (!args.apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (plan.length === 0) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  ensureDir(backupDir);
  for (const entry of plan) {
    const backupPath = path.join(backupDir, entry.relPath);
    if (!exists(backupPath)) {
      copyWithParents(entry.filePath, backupPath);
    }
  }

  for (const entry of plan) {
    fs.writeFileSync(entry.filePath, entry.nextRaw, "utf8");
  }

  const summaryPath = path.join(backupDir, "summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main();

