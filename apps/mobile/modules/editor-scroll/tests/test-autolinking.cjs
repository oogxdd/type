const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const mobileRoot = path.resolve(__dirname, "../../..");
const resolved = JSON.parse(execFileSync(process.execPath, [
  "--eval", "require('expo/bin/autolinking')", "expo-modules-autolinking",
  "resolve", "--platform", "apple", "--json", "--project-root", mobileRoot,
], { cwd: mobileRoot, encoding: "utf8" }));
const moduleInfo = resolved.modules.find((entry) => entry.packageName === "editor-scroll");
assert(moduleInfo?.modules.some((entry) => entry.class === "EditorScrollModule"));
assert(moduleInfo.swiftModuleNames.includes("EditorScroll"));
assert(moduleInfo.pods.some((entry) => entry.podspecDir === path.dirname(__dirname)));
console.log("EditorScroll native module registration passed");
