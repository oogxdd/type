# Desktop auto-update — setup & release guide

This app ships a **native desktop auto-updater** (Tauri updater plugin). Once a
user has *any* build that contains it installed, every future release is
delivered in-app via **Settings → Updates → Desktop app → "Check for updates"**.
No more handing out `.dmg` files.

> The first build a user installs (the one with the updater baked in) still has
> to be delivered as a `.dmg`. After that, updates are automatic.

This document lists **everything you must do by hand** — the code/config is
already wired up.

---

## What's already done (in the repo)

- `src-tauri/Cargo.toml` — added `tauri-plugin-updater` + `tauri-plugin-process` (desktop-only).
- `src-tauri/src/commands/mod.rs` — registers both plugins under `#[cfg(desktop)]`.
- `src-tauri/tauri.conf.json` — `bundle.createUpdaterArtifacts: true` + `plugins.updater` (pubkey placeholder + endpoint).
- `src-tauri/capabilities/updater.json` — grants the window `updater` + `process:allow-restart` permissions (desktop platforms only).
- `package.json` — added `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process`.
- `src/components/settings/SettingsUpdatesSection.tsx` — "Desktop app" updater UI (check → download w/ progress → relaunch).

---

## One-time setup (you must do this)

### 1. Generate the updater signing keypair

Updates must be cryptographically signed; the app refuses anything signed with a
different key. This key is **separate** from Apple code-signing.

```bash
npm run tauri signer generate -- -w ~/.tauri/type-updater.key
```

You'll be prompted for a password (can be empty, but a password is recommended).
This produces:

- `~/.tauri/type-updater.key` — **PRIVATE key. Never commit. Back it up safely.**
- `~/.tauri/type-updater.key.pub` — public key.

> ⚠️ If you ever lose the private key, you cannot push updates to already-installed
> apps anymore — users would have to reinstall a new `.dmg` built with a new key.
> Store it in a password manager.

### 2. Paste the public key into config

> **Done as of 0.4.5.** `plugins.updater.pubkey` now holds the real key from
> `~/.tauri/type-updater.key.pub` (key id `38459F9A77300925`), which is the same
> key the `TAURI_SIGNING_PRIVATE_KEY` CI secret signs with. Builds released
> before 0.4.5 shipped the placeholder and **cannot auto-update** — those installs
> need one manual `.dmg` install to get onto the updater path.

Open `src-tauri/tauri.conf.json` and replace the placeholder:

```jsonc
"plugins": {
  "updater": {
    "pubkey": "REPLACE_WITH_UPDATER_PUBLIC_KEY",   // ← paste contents of type-updater.key.pub
    "endpoints": [
      "https://github.com/oogxdd/type/releases/latest/download/latest.json"
    ]
  }
}
```

Paste the **full single-line contents** of `~/.tauri/type-updater.key.pub`.

To do it without manually editing JSON:

```bash
PUBKEY="$(tr -d '\n' < ~/.tauri/type-updater.key.pub)"
node -e '
const fs = require("fs");
const path = "src-tauri/tauri.conf.json";
const config = JSON.parse(fs.readFileSync(path, "utf8"));
config.plugins.updater.pubkey = process.env.PUBKEY;
fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
'
```

Commit this config change. The `.pub` key is public and safe to commit; the
private `~/.tauri/type-updater.key` must never be committed.

If you see `failed to decode pubkey ... Invalid symbol 95, offset 7`, the
placeholder `REPLACE_WITH_UPDATER_PUBLIC_KEY` is still in the config. The `_`
character is symbol 95.

> The endpoint already points at your GitHub repo's latest release. Change it if
> you host releases elsewhere. `{{target}}`, `{{arch}}`, `{{current_version}}`
> placeholders are supported in the URL if you want per-platform manifests.

### 3. Install JS deps (already done once, but for fresh clones)

```bash
npm install
```

---

## Cutting a release (every time)

### 1. Bump the version

The version in `src-tauri/tauri.conf.json` is what the updater compares against.
Keep it in sync with `package.json`:

```bash
npm version patch        # or minor / major — bumps package.json
npm run version:sync     # copies the new version into tauri.conf.json
```

### 2. Build the signed bundle (on a Mac)

The updater needs the signing key available as env vars at build time:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/type-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<the password you set>"

npm run tauri build -- --bundles app,dmg
```

This produces, in `src-tauri/target/release/bundle/`:

- `dmg/Type_<version>_aarch64.dmg` — the installer (for first-time installs).
- `macos/Type.app.tar.gz` — the **update payload**.
- `macos/Type.app.tar.gz.sig` — the **signature** for that payload.

`dmg` alone is not enough for auto-update publishing: Tauri will create the
installer, but not the updater payload/signature. Include `app,dmg`.

> Build on Apple Silicon → `aarch64`. For Intel Macs you'd also build the
> `x86_64-apple-darwin` target (or a `universal-apple-darwin` build) and add a
> matching `darwin-x86_64` entry to `latest.json`.

### 3. Write `latest.json`

Create a file named `latest.json`:

```json
{
  "version": "0.4.3",
  "notes": "Short changelog shown in the update dialog.",
  "pub_date": "2026-06-02T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<paste the ENTIRE contents of Type.app.tar.gz.sig>",
      "url": "https://github.com/oogxdd/type/releases/download/desktop-v0.4.3/Type.app.tar.gz"
    }
  }
}
```

- `version` must match the new app version.
- `signature` is the literal text inside the `.sig` file (a long base64 string).
- `url` must point at where you'll upload `Type.app.tar.gz` (next step).

### 4. Publish a GitHub Release

```bash
gh release create desktop-v0.4.3 \
  "src-tauri/target/release/bundle/dmg/Type_0.4.3_aarch64.dmg" \
  "src-tauri/target/release/bundle/macos/Type.app.tar.gz" \
  "latest.json" \
  --title "Type Desktop 0.4.3" --notes "Release notes here" --latest
```

Because the configured endpoint is `.../releases/latest/download/latest.json`,
GitHub automatically serves the `latest.json` from whichever release is marked
"Latest". Done — installed apps will now find this update.

### 5. Verify

On a Mac running an **older** installed build: open **Settings → Updates →
Desktop app → Check for updates**. It should detect the new version, download
with a progress readout, install, and relaunch into the new version.

---

## Automated with GitHub Actions

`.github/workflows/release.yml` runs on `desktop-v*` tags and uses
[`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action) to build,
sign, generate `latest.json`, and create the GitHub Release on tag push. It needs
two repo secrets:

- `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/type-updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — its password

(Plus, if you want notarization, the Apple signing secrets — see
[RELEASING.md](./RELEASING.md).)

---

## Gotchas / notes

- **Unsigned-by-Apple builds still work** for updates, but macOS refuses to
  *launch* the first `.dmg` a user opens — on macOS 26 with the misleading
  "…is damaged and can't be opened", and right-click → Open no longer bypasses
  it. `xattr -dr com.apple.quarantine /Applications/Type.app` does. Apple
  notarization removes the problem entirely — see
  [MACOS_CODE_SIGNING.md](./MACOS_CODE_SIGNING.md); it is separate from the
  updater signing above.
- The **updater signature** (`TAURI_SIGNING_*`) and **Apple code-signing /
  notarization** are two independent things. The updater refuses unsigned-by-*you*
  payloads regardless of Apple status.
