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
- `src-tauri/tauri.conf.json` — `bundle.createUpdaterArtifacts: true` + `plugins.updater` (real pubkey + endpoint).
- `src-tauri/tauri.dev.conf.json` — `plugins.updater.endpoints: []`, so a dev build never pulls a production release over itself.
- `src-tauri/capabilities/updater.json` — grants the window `updater` + `process:allow-restart` permissions (desktop platforms only).
- `package.json` — added `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process`.
- `src/features/settings/components/desktop/updates-section.tsx` — "Desktop app" updater UI (check → download w/ progress → relaunch).

Updating is **entirely manual on the user's side**: nothing checks on launch and
nothing downloads on its own. `check()` runs only from the "Check for updates"
button, and the payload downloads only after "Download & install".

---

## One-time setup

Already done for this repo. The updater keypair exists, its public half is in
`tauri.conf.json`, and the `TAURI_SIGNING_*` secrets are set on `oogxdd/type`.

You only revisit this to **generate or rotate the key** — that is its own
document, including what rotating costs and how to carry installed users across
one: [UPDATER_KEY_ROTATION.md](./UPDATER_KEY_ROTATION.md).

> If `plugins.updater.pubkey` ever reads `REPLACE_WITH_UPDATER_PUBLIC_KEY`, every
> build made from it is a dead end: it can check for updates but never verify
> one, and the only way out is a manual `.dmg` install. Releases 0.4.3 and 0.4.4
> shipped that way and are marked pre-release for exactly this reason. The
> matching runtime error is `failed to decode pubkey … Invalid symbol 95,
> offset 7` — symbol 95 is the `_` in the placeholder.

---

## Cutting a release

**Releases are tag-driven — see [RELEASING.md](./RELEASING.md).** Push a
`desktop-v1.2.3` tag and CI builds, signs, generates `latest.json`, and publishes
the GitHub Release; `apps/desktop/scripts/release-local.sh` does the same on your
own Mac. Neither needs you to hand-edit a version or write `latest.json`.

What the updater cares about, whichever path builds it:

- The version CI writes into `tauri.conf.json` (from the tag) is what an
  installed app compares itself against.
- `--bundles app,dmg` is required. `dmg` alone produces the installer but not
  `Type_aarch64.app.tar.gz` / `.sig`, and without those there is nothing to
  update *to*.
- `latest.json` must be an asset of whichever release is marked **Latest** —
  that is what the configured endpoint (`…/releases/latest/download/latest.json`)
  resolves to. The desktop workflow forces that flag; mobile releases are
  explicitly kept from stealing it.

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
