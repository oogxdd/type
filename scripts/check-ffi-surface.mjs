#!/usr/bin/env node
// Guards the hand-maintained FFI seam: packages/mobile-core/src/raw-core.ts
// must list exactly the functions that crates/type-ffi exports via
// #[uniffi::export]. See docs/architecture/08-shared-code-review.md
// ("triple bookkeeping") for why this drifts silently otherwise.
//
// Modes:
//   node scripts/check-ffi-surface.mjs
//       Compare type-ffi's exported fn names (snake_case → camelCase)
//       against the RawCore interface. Cheap; runs anywhere.
//   node scripts/check-ffi-surface.mjs --generated <dir>
//       Compare the ubrn-generated TS bindings in <dir> against RawCore.
//       Run after `ubrn ... --and-generate` (Mac codegen job).
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ffiDir = join(repoRoot, "crates/type-ffi/src");
const rawCorePath = join(repoRoot, "packages/mobile-core/src/raw-core.ts");

const snakeToCamel = (name) => name.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

// --- type-ffi: functions annotated with #[uniffi::export] --------------------
function collectFfiFunctions() {
  const names = new Set();
  for (const file of readdirSync(ffiDir).filter((f) => f.endsWith(".rs"))) {
    const lines = readFileSync(join(ffiDir, file), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*#\[uniffi::export/.test(lines[i])) continue;
      // Find the item this attribute annotates (skip further attributes/comments).
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (/^\s*(#\[|\/\/)/.test(line) || line.trim() === "") continue;
        // Traits (e.g. TranscriptionProvider, with_foreign) are represented in
        // RawCore as a callback-object parameter, not as functions — skip them.
        const fn = line.match(/^\s*pub\s+(?:async\s+)?fn\s+([a-zA-Z0-9_]+)/);
        if (fn) names.add(snakeToCamel(fn[1]));
        break;
      }
    }
  }
  return names;
}

// --- raw-core.ts: methods of the RawCore interface ---------------------------
function collectRawCoreMethods() {
  const source = readFileSync(rawCorePath, "utf8");
  const block = source.match(/export interface RawCore \{([\s\S]*?)\n\}/);
  if (!block) {
    console.error(`Could not find 'export interface RawCore {' in ${rawCorePath}`);
    process.exit(2);
  }
  const names = new Set();
  // `name?(` is a deliberate declaration, not drift: a method is marked
  // optional when native modules generated before it existed may lack it and
  // core-api feature-detects. Match those too, or the guard reports a method
  // that is in fact declared right there.
  for (const match of block[1].matchAll(/^\s{2}([a-zA-Z0-9_]+)\??\(/gm)) {
    names.add(match[1]);
  }
  return names;
}

// --- generated bindings: exported functions ----------------------------------
function collectGeneratedExports(dir) {
  const names = new Set();
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) {
        const source = readFileSync(path, "utf8");
        for (const m of source.matchAll(
          /export\s+(?:async\s+)?function\s+([a-zA-Z0-9_]+)/g
        )) {
          names.add(m[1]);
        }
        for (const m of source.matchAll(/export\s+const\s+([a-zA-Z0-9_]+)\s*[:=]/g)) {
          names.add(m[1]);
        }
      }
    }
  };
  walk(dir);
  return names;
}

function diff(labelA, a, labelB, b) {
  const missing = [...a].filter((n) => !b.has(n)).sort();
  const extra = [...b].filter((n) => !a.has(n)).sort();
  let failed = false;
  if (missing.length) {
    failed = true;
    console.error(`In ${labelA} but missing from ${labelB}:`);
    for (const n of missing) console.error(`  - ${n}`);
  }
  if (extra.length) {
    failed = true;
    console.error(`In ${labelB} but not in ${labelA}:`);
    for (const n of extra) console.error(`  - ${n}`);
  }
  return failed;
}

const generatedFlag = process.argv.indexOf("--generated");
const rawCore = collectRawCoreMethods();

if (generatedFlag !== -1) {
  const dir = process.argv[generatedFlag + 1];
  if (!dir) {
    console.error("--generated requires a directory argument");
    process.exit(2);
  }
  const generated = collectGeneratedExports(join(repoRoot, dir));
  // The generated module may export more than RawCore uses (helpers,
  // initializers) — only RawCore methods absent from codegen are fatal.
  const missing = [...rawCore].filter((n) => !generated.has(n)).sort();
  if (missing.length) {
    console.error("RawCore methods missing from the generated bindings:");
    for (const n of missing) console.error(`  - ${n}`);
    process.exit(1);
  }
  console.log(
    `OK: all ${rawCore.size} RawCore methods exist in the generated bindings (${generated.size} exports scanned).`
  );
} else {
  const ffi = collectFfiFunctions();
  const failed = diff("type-ffi (#[uniffi::export])", ffi, "RawCore (raw-core.ts)", rawCore);
  if (failed) {
    console.error(
      "\nFFI surface drift. Update packages/mobile-core/src/raw-core.ts (and regenerate the native module on a Mac) after changing crates/type-ffi."
    );
    process.exit(1);
  }
  console.log(`OK: type-ffi and RawCore agree on ${ffi.size} functions.`);
}
