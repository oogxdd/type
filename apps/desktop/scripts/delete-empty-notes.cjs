#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

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
    return { body: raw };
  }
  const close = raw.indexOf("\n---\n", 4);
  if (close === -1) {
    return { body: raw };
  }
  return { body: raw.slice(close + 5) };
}

function isBodyEmpty(body) {
  const normalized = body
    .replace(/NV_EMPTY_LINE_TOKEN_[A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, "")
    .trim();
  return normalized.length === 0;
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
  const backupDir = path.join(root, ".migration-backups", `delete-empty-notes-${stamp}`);

  const markdown = walkMarkdown(root);
  const candidates = markdown
    .map((filePath) => {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = parseFrontMatter(raw);
      return {
        filePath,
        relPath: path.relative(root, filePath),
        dir: path.dirname(filePath),
        fileName: path.basename(filePath),
        empty: isBodyEmpty(parsed.body),
      };
    })
    .filter((entry) => entry.empty);

  const deleteNamesByFolder = new Map();
  for (const entry of candidates) {
    if (!deleteNamesByFolder.has(entry.dir)) {
      deleteNamesByFolder.set(entry.dir, new Set());
    }
    deleteNamesByFolder.get(entry.dir).add(entry.fileName);
  }

  const orderFiles = [];
  for (const [folder, deleteNames] of deleteNamesByFolder.entries()) {
    const orderPath = path.join(folder, ".notes-order.json");
    if (!exists(orderPath)) {
      continue;
    }
    const parsed = readJsonOrNull(orderPath);
    if (!parsed || !Array.isArray(parsed.note_order)) {
      continue;
    }
    const next = parsed.note_order.filter((name) => !deleteNames.has(name));
    if (next.length === parsed.note_order.length) {
      continue;
    }
    parsed.note_order = next;
    orderFiles.push({
      filePath: orderPath,
      relPath: path.relative(root, orderPath),
      json: parsed,
    });
  }

  const summary = {
    root,
    apply: args.apply,
    backupDir,
    totalNotes: markdown.length,
    deleted: candidates.length,
    orderFilesUpdated: orderFiles.length,
    preview: candidates.slice(0, 50).map((entry) => entry.relPath),
  };

  if (!args.apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (candidates.length === 0 && orderFiles.length === 0) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  ensureDir(backupDir);
  for (const entry of candidates) {
    const backupPath = path.join(backupDir, entry.relPath);
    if (!exists(backupPath)) {
      copyWithParents(entry.filePath, backupPath);
    }
  }
  for (const order of orderFiles) {
    const backupPath = path.join(backupDir, order.relPath);
    if (!exists(backupPath)) {
      copyWithParents(order.filePath, backupPath);
    }
  }

  for (const entry of candidates) {
    fs.unlinkSync(entry.filePath);
  }
  for (const order of orderFiles) {
    fs.writeFileSync(order.filePath, `${JSON.stringify(order.json, null, 2)}\n`, "utf8");
  }

  const summaryPath = path.join(backupDir, "summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main();

