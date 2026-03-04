import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = process.cwd();
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const version = pkg.version;

const parseDotenv = (filepath) => {
  if (!existsSync(filepath)) {
    return {};
  }
  const text = readFileSync(filepath, "utf8");
  const entries = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    const raw = trimmed.slice(idx + 1).trim();
    const value = raw.replace(/^["']|["']$/g, "");
    entries[key] = value;
  }
  return entries;
};

const normalizeBaseUrl = (url) => url.replace(/\/+$/, "");

const inferBaseFromManifestUrl = (manifestUrl) =>
  manifestUrl.replace(/\/+$/, "").replace(/\/manifest\.json$/i, "");

const dotenv = {
  ...parseDotenv(join(rootDir, ".env")),
  ...parseDotenv(join(rootDir, ".env.local")),
};

const manifestUrl = process.env.VITE_OTA_MANIFEST_URL?.trim() || dotenv.VITE_OTA_MANIFEST_URL;
const explicitCdnBaseUrl = process.env.OTA_CDN_BASE_URL?.trim();
const cdnBaseUrl = explicitCdnBaseUrl || (manifestUrl ? inferBaseFromManifestUrl(manifestUrl) : "");

if (!cdnBaseUrl) {
  console.error(
    "Missing OTA base URL. Set OTA_CDN_BASE_URL or VITE_OTA_MANIFEST_URL (in env or .env)."
  );
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
  url: `${normalizeBaseUrl(cdnBaseUrl)}/${jsName}`,
  hash,
  notes: `Type OTA ${version}`,
};

writeFileSync(join(otaOutDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${join("dist", "ota", "manifest.json")}`);
