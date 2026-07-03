#!/usr/bin/env node
// The mobile analogue of `tauri dev`'s Rust watcher: watches crates/ and
// rebuilds + reinstalls the iOS dev client (npm run mobile:ios) on changes.
//
// An iOS rebuild takes minutes, so runs are serialized: saves that land
// during a build queue exactly one follow-up run instead of piling up.
//
//   npm run mobile:ios:watch
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// The cargo workspace keeps target/ at the repo root, so crates/ holds only
// sources — safe to watch recursively.
const WATCHED = "crates";
const DEBOUNCE_MS = 1500;

let timer = null;
let running = false;
let queued = false;

function rebuild() {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  console.log("[watch] Rust changed → npm run mobile:ios");
  const child = spawn("npm", ["run", "mobile:ios"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    running = false;
    console.log(`[watch] mobile:ios exited with code ${code}; watching…`);
    if (queued) {
      queued = false;
      rebuild();
    }
  });
}

watch(join(repoRoot, WATCHED), { recursive: true }, (_event, file) => {
  if (!file || !/\.(rs|toml)$/.test(String(file))) return;
  console.log(`[watch] ${join(WATCHED, String(file))}`);
  clearTimeout(timer);
  timer = setTimeout(rebuild, DEBOUNCE_MS);
});

console.log(`[watch] watching ${WATCHED}/ for .rs/.toml changes; Ctrl+C to stop.`);
