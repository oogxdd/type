const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const mobileRoot = path.resolve(__dirname, "../../..");
const resolved = JSON.parse(execFileSync(process.execPath, [
  "--eval", "require('expo/bin/autolinking')", "expo-modules-autolinking",
  "resolve", "--platform", "apple", "--json", "--project-root", mobileRoot,
], { cwd: mobileRoot, encoding: "utf8" }));
const native = resolved.modules.find((entry) => entry.packageName === "background-task");
assert(native?.modules.some((entry) => entry.class === "BackgroundTaskModule"));
assert(native.swiftModuleNames.includes("BackgroundTask"));
console.log("BackgroundTask registration (including isolated XCTest fixtures) passed");
