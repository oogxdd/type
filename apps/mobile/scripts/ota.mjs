#!/usr/bin/env node
// Over-the-air install for an ad-hoc .ipa.
//
// iOS installs a signed build from a plain web page: Safari opens an
// `itms-services://` URL pointing at a manifest, the manifest points at the
// .ipa, and both must come over HTTPS with a publicly trusted certificate
// (that requirement has been in place since iOS 7.1). The device's UDID still
// has to be in the provisioning profile, so this changes delivery only, never
// who can install.
//
//   build  — write a self-contained folder to upload to any static host
//   serve  — run the same site locally, for a tunnel to terminate HTTPS in
//            front of; the manifest is generated per request from the Host
//            header, so the public URL does not have to be known up front
//
// Usage:
//   node scripts/ota.mjs build ios/build/export-adhoc/Type.ipa \
//     --base-url https://type-ota.example.com
//   node scripts/ota.mjs serve ios/build/export-adhoc/Type.ipa --port 8787

import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const IPA_NAME = "Type.ipa";

const die = (message) => {
  console.error(message);
  process.exit(1);
};

const parseArgs = (argv) => {
  const [command, ipa, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    if (!rest[i].startsWith("--")) continue;
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return { command, ipa, flags };
};

/**
 * Reads bundle id / version / name out of the .ipa itself.
 *
 * Taking them from app.json instead would be a guess about what was actually
 * signed — the whole point of a manifest is that iOS matches it against the
 * payload, and a mismatched `bundle-version` makes the install silently do
 * nothing.
 */
const readIpaMetadata = async (ipaPath) => {
  const scratch = await mkdtemp(join(tmpdir(), "type-ota-"));
  try {
    const names = execFileSync("unzip", ["-Z1", ipaPath], { encoding: "utf8" })
      .split("\n")
      .filter((name) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(name));
    if (names.length !== 1) {
      die(`Expected exactly one app Info.plist in ${ipaPath}, found ${names.length}.`);
    }
    const extracted = join(scratch, "Info.plist");
    // The payload plist is binary; plutil converts it in place.
    await writeFile(extracted, execFileSync("unzip", ["-p", ipaPath, names[0]]));
    const json = execFileSync("plutil", ["-convert", "json", "-o", "-", extracted], {
      encoding: "utf8",
    });
    const info = JSON.parse(json);
    return {
      bundleId: info.CFBundleIdentifier,
      shortVersion: info.CFBundleShortVersionString,
      build: info.CFBundleVersion,
      title: info.CFBundleDisplayName || info.CFBundleName || "App",
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};

const manifestPlist = (meta, ipaUrl) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${ipaUrl}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${meta.bundleId}</string>
        <key>bundle-version</key>
        <string>${meta.shortVersion}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${meta.title}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;

const installUrl = (manifestUrl) =>
  `itms-services://?action=download-manifest&amp;url=${encodeURIComponent(manifestUrl)}`;

const landingPage = (meta, manifestUrl) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Install ${meta.title}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font: 17px/1.5 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    margin: 0; padding: 2.5rem 1.25rem; display: flex; justify-content: center;
  }
  main { max-width: 26rem; width: 100%; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  .version { opacity: .6; margin: 0 0 2rem; }
  a.install {
    display: block; text-align: center; text-decoration: none;
    padding: .9rem 1rem; border-radius: .75rem;
    background: #0a84ff; color: #fff; font-weight: 600;
  }
  ul { padding-left: 1.1rem; margin: 2rem 0 0; }
  li { margin-bottom: .6rem; }
  strong { font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>${meta.title}</h1>
  <p class="version">${meta.shortVersion} (${meta.build}) &middot; ${meta.bundleId}</p>

  <a class="install" href="${installUrl(manifestUrl)}">Install</a>

  <ul>
    <li>Open this page in <strong>Safari</strong>. Other browsers ignore the
      <code>itms-services</code> scheme and the button does nothing.</li>
    <li>Only devices registered in the provisioning profile can install this
      build; anyone else gets "unable to install".</li>
    <li>This build is signed for ad-hoc distribution. If a copy of the same
      bundle id from TestFlight or the App Store is already installed, iOS
      refuses to install over it &mdash; the existing app has to be deleted
      first, <strong>which erases its local data</strong>.</li>
  </ul>
</main>
</body>
</html>
`;

/** Vercel/Netlify-style hosts guess wrong content types for these two. */
const vercelConfig = () =>
  JSON.stringify(
    {
      headers: [
        {
          source: "/manifest.plist",
          headers: [{ key: "Content-Type", value: "text/xml; charset=utf-8" }],
        },
        {
          source: `/${IPA_NAME}`,
          headers: [
            { key: "Content-Type", value: "application/octet-stream" },
          ],
        },
      ],
    },
    null,
    2
  ) + "\n";

const build = async (ipaPath, flags) => {
  const baseUrl = typeof flags["base-url"] === "string" ? flags["base-url"] : null;
  if (!baseUrl) {
    die("build needs --base-url https://host (the URL the phone will open).");
  }
  if (!baseUrl.startsWith("https://")) {
    die(`--base-url must be https, got ${baseUrl}. iOS rejects plain http manifests.`);
  }
  const root = baseUrl.replace(/\/+$/, "");
  const out = resolve(
    typeof flags.out === "string" ? flags.out : "ios/build/ota"
  );
  const meta = await readIpaMetadata(ipaPath);

  await mkdir(out, { recursive: true });
  await copyFile(ipaPath, join(out, IPA_NAME));
  await writeFile(
    join(out, "manifest.plist"),
    manifestPlist(meta, `${root}/${IPA_NAME}`)
  );
  await writeFile(
    join(out, "index.html"),
    landingPage(meta, `${root}/manifest.plist`)
  );
  await writeFile(join(out, "vercel.json"), vercelConfig());

  const { size } = await stat(join(out, IPA_NAME));
  console.log(`${meta.title} ${meta.shortVersion} (${meta.build}) — ${meta.bundleId}`);
  console.log(`${out}  (${(size / 1e6).toFixed(1)} MB payload)`);
  console.log(`\nUpload that folder, then open ${root}/ in Safari on the device.`);
};

const serve = async (ipaPath, flags) => {
  const port = Number(flags.port ?? 8787);
  const meta = await readIpaMetadata(ipaPath);
  const { size } = await stat(ipaPath);

  const server = createServer((req, res) => {
    // Behind a tunnel the public origin is only visible in the request, so
    // build the absolute URLs the manifest needs from the headers rather than
    // asking for them up front.
    const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim();
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? `localhost:${port}`);
    const root = `${proto}://${host}`;
    const path = (req.url ?? "/").split("?")[0];

    if (path === "/" || path === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(landingPage(meta, `${root}/manifest.plist`));
      return;
    }
    if (path === "/manifest.plist") {
      if (proto !== "https") {
        console.warn(`manifest requested over ${proto} — iOS will refuse it`);
      }
      res.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
      res.end(manifestPlist(meta, `${root}/${IPA_NAME}`));
      return;
    }
    if (path === `/${IPA_NAME}`) {
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(size),
      });
      createReadStream(ipaPath).pipe(res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found\n");
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`${meta.title} ${meta.shortVersion} (${meta.build}) on :${port}`);
    console.log(`serving ${basename(ipaPath)} (${(size / 1e6).toFixed(1)} MB)\n`);
    console.log("iOS needs a trusted HTTPS origin, so put a tunnel in front:");
    console.log(`  cloudflared tunnel --url http://localhost:${port}`);
    console.log(`  ngrok http ${port}`);
    console.log("\nThen open the tunnel's https URL in Safari on the device.");
  });
};

const main = async () => {
  const { command, ipa, flags } = parseArgs(process.argv.slice(2));
  if (!command || !ipa || flags.help) {
    die(
      "usage:\n" +
        "  node scripts/ota.mjs build <ipa> --base-url https://host [--out dir]\n" +
        "  node scripts/ota.mjs serve <ipa> [--port 8787]"
    );
  }
  const ipaPath = resolve(ipa);
  await stat(ipaPath).catch(() => die(`No such file: ${ipaPath}`));
  if (command === "build") return build(ipaPath, flags);
  if (command === "serve") return serve(ipaPath, flags);
  die(`Unknown command: ${command}`);
};

await main();
