import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = process.cwd();
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const version = pkg.version;
const cdnBaseUrl = process.env.OTA_CDN_BASE_URL?.trim();

if (!cdnBaseUrl) {
  console.error("Missing OTA_CDN_BASE_URL. Example: https://cdn.example.com/type");
  process.exit(1);
}

const appJsPath = join(rootDir, "dist", "app.js");
const appCssPath = join(rootDir, "dist", "app.css");
const otaOutDir = join(rootDir, "dist", "ota");
mkdirSync(otaOutDir, { recursive: true });

const jsName = `app-${version}.js`;
const cssName = `app-${version}.css`;
const jsBytes = readFileSync(appJsPath);
const hash = `sha256-${createHash("sha256").update(jsBytes).digest("base64")}`;

copyFileSync(appJsPath, join(otaOutDir, jsName));
copyFileSync(appCssPath, join(otaOutDir, cssName));

const manifest = {
  version,
  url: `${cdnBaseUrl.replace(/\/+$/, "")}/${jsName}`,
  hash,
  notes: `Type OTA ${version}`,
};

writeFileSync(join(otaOutDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${join("dist", "ota", "manifest.json")}`);
