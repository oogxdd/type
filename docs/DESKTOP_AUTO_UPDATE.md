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

Open `src-tauri/tauri.conf.json` and replace the placeholder:

```jsonc
"plugins": {
  "updater": {
    "pubkey": "REPLACE_WITH_UPDATER_PUBLIC_KEY",   // ← paste contents of type-updater.key.pub
    "endpoints": [
      "https://github.com/oogxdd/type_new/releases/latest/download/latest.json"
    ]
  }
}
```

Paste the **full single-line contents** of `~/.tauri/type-updater.key.pub`.

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
      "url": "https://github.com/oogxdd/type_new/releases/download/v0.4.3/Type.app.tar.gz"
    }
  }
}
```

- `version` must match the new app version.
- `signature` is the literal text inside the `.sig` file (a long base64 string).
- `url` must point at where you'll upload `Type.app.tar.gz` (next step).

### 4. Publish a GitHub Release

```bash
gh release create v0.4.3 \
  "src-tauri/target/release/bundle/dmg/Type_0.4.3_aarch64.dmg" \
  "src-tauri/target/release/bundle/macos/Type.app.tar.gz" \
  "latest.json" \
  --title "v0.4.3" --notes "Release notes here"
```

Because the configured endpoint is `.../releases/latest/download/latest.json`,
GitHub automatically serves the `latest.json` from whichever release is marked
"Latest". Done — installed apps will now find this update.

### 5. Verify

On a Mac running an **older** installed build: open **Settings → Updates →
Desktop app → Check for updates**. It should detect the new version, download
with a progress readout, install, and relaunch into the new version.

---

## Optional: automate with GitHub Actions

You already have `.github/workflows/deploy-pages.yml`. A release workflow using
[`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action) can build,
sign, generate `latest.json`, and create the GitHub Release on tag push. It needs
two repo secrets:

- `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/type-updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — its password

(Plus the macOS runner and, if you want notarization, the Apple signing secrets.)
Ask and I can write this workflow.

---

## Gotchas / notes

- **Unsigned-by-Apple builds still work** for updates, but the *first* `.dmg` a
  user opens triggers the macOS Gatekeeper "unidentified developer" warning
  (right-click → Open to bypass). Apple notarization removes that — separate from
  the updater signing above.
- The **updater signature** (`TAURI_SIGNING_*`) and **Apple code-signing /
  notarization** are two independent things. The updater refuses unsigned-by-*you*
  payloads regardless of Apple status.
- iOS keeps using the existing **OTA JS-bundle** updater (`@inkibra/tauri-plugin-ota`,
  the second section in Settings → Updates). It is unrelated to this desktop binary
  updater.
- The updater plugin is desktop-only; it is compiled out of mobile builds via
  `#[cfg(desktop)]`, so it won't affect your iOS build.
