# Releasing — versioning & CI

Desktop (macOS Tauri app, auto-updates in-app) and mobile (React Native /
Expo) releases are **tag-driven** and intentionally separate.

- The **git tag is the release trigger and the source of truth for the version.**
  You don't have to commit a version bump — tagging *is* the release. CI reads the
  version out of the tag and writes it into the app config before building. (The
  version committed in the repo is just the dev baseline.)
- See also: [DESKTOP_AUTO_UPDATE.md](./DESKTOP_AUTO_UPDATE.md) for the desktop
  updater internals and one-time signing-key setup.
- For future Mac App Store / TestFlight releases, see
  [MACOS_APP_STORE_TESTFLIGHT.md](./MACOS_APP_STORE_TESTFLIGHT.md).

---

## 1. Versioning model

**Separate tag namespaces.** Desktop and mobile can move independently:

```
desktop-v0.5.0   desktop 0.5.0
mobile-v0.2.0    mobile 0.2.0
desktop-v0.5.1   desktop 0.5.1
```

> Why GitHub's *latest* release matters for the updater: the desktop updater
> reads `…/releases/latest/download/latest.json`, so the desktop release must be
> marked as GitHub's latest release. The desktop workflow forces the `latest`
> flag on every desktop release. Mobile releases are also listed on GitHub,
> but are explicitly prevented from replacing the latest desktop release.

---

## 2. How to cut a desktop release

### Option A — push a tag (normal path)

```bash
git checkout main && git pull          # release from main
npm version 0.5.0 --no-git-tag-version  # optional: keep repo baseline in sync
git commit -am "Release 0.5.0" || true

git tag desktop-v0.5.0
git push origin desktop-v0.5.0
```

CI ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) builds
the `.dmg` + updater artifacts and publishes the GitHub Release.

### Option B — manual run (no tag)

Actions tab → **Desktop Release** → **Run workflow** → enter the version.
Useful for re-running a failed build.

### Option C — build locally (the free-tier fallback)

GitHub's free macOS runners are limited (minutes reset monthly; macOS minutes
bill at 10× the included pool, so you get relatively few builds). When you run
out, build on your Mac with the **same result**:

```bash
# desktop needs the updater signing key in the environment:
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/type-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password>"

apps/desktop/scripts/release-local.sh 0.5.0
```

It bumps the version, builds, signs, assembles `latest.json`, and creates the
GitHub Release via `gh` — exactly what CI does. (`gh auth login` required once.)

---

## 2b. Developing locally without touching the installed prod app

The released app and a local dev build are **fully separate installs with
separate data**, as long as you use the dev config. Never point a dev run at the
production identifier — `com.digital.type2`'s app-data directory is where the
real notes live.

| | Production | Dev |
| --- | --- | --- |
| Bundle | `/Applications/Type.app` | `/Applications/Type Dev.app` |
| Identifier | `com.digital.type2` | `com.digital.type2.dev` |
| App data (notes, profiles, keys) | `~/Library/Application Support/com.digital.type2` | `~/Library/Application Support/com.digital.type2.dev` |
| Auto-update | on (GitHub `latest.json`) | off (`endpoints: []`) |

Everything above the identifier line is driven by
`apps/desktop/src-tauri/tauri.dev.conf.json`, which Tauri deep-merges over
`tauri.conf.json`.

```bash
npm run desktop:app       # dev run against the dev identifier — safe
npm run desktop:dmg:dev   # "Type Dev.dmg", installs alongside prod
```

`npm run desktop:app:prod-data` exists as an explicit escape hatch: it runs the
dev build against the **production** app-data directory. Use it only when you
deliberately need to reproduce something against real notes, and back up first
(see below).

The dev config sets `plugins.updater.endpoints: []`, so a dev build can never
download and overwrite itself with a production release. The updater errors with
`EmptyEndpoints` if you press "Check for updates" there — that is intended.

### Backing up production data

Everything the desktop app owns lives under one directory:

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
rsync -aH --exclude 'whisper/' --exclude '.DS_Store' \
  "$HOME/Library/Application Support/com.digital.type2/" \
  "/Volumes/KINGSTON/Backups/type/prod-$STAMP/app-data/"
ditto /Applications/Type.app "/Volumes/KINGSTON/Backups/type/prod-$STAMP/Type.app"
```

`whisper/` is excluded because the managed Python env re-provisions itself.
Everything that matters — `notes/`, `profiles/`, `config.json`,
`.notes-profiles.json`, `local_sync/` — is a few tens of MB.

---

## 3. How to cut a mobile release

```bash
git checkout main && git pull
git tag mobile-v0.2.0
git push origin mobile-v0.2.0
```

CI ([`.github/workflows/mobile-testflight.yml`](../.github/workflows/mobile-testflight.yml)):

1. creates a metadata-only GitHub Release without changing the desktop Latest,
2. runs on a macOS runner,
3. generates the iOS UniFFI/native module from `packages/mobile-core`,
4. builds a local EAS `.ipa` from `apps/mobile`, and
5. submits that `.ipa` to TestFlight.

The workflow sets `MOBILE_VERSION` from the tag and uses the GitHub run number
as `IOS_BUILD_NUMBER`. For a manual rerun, use Actions → **Mobile TestFlight**
and optionally enter an explicit build number.

---

## 4. Required GitHub secrets

Add under **Settings → Secrets and variables → Actions**.

### Mobile (required)

| Secret       | What it is                                      |
| ------------ | ----------------------------------------------- |
| `EXPO_TOKEN` | Expo access token with access to the EAS project |

EAS must also have remote iOS build credentials for `com.typenotes.mobile` and
submit credentials for App Store Connect.

### Desktop (required)

| Secret                                | What it is                                            |
| ------------------------------------- | ----------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`           | Contents of `~/.tauri/type-updater.key`               |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`  | Password for that key                                 |

`GITHUB_TOKEN` is provided automatically (used to create the Release).

### Desktop — Apple notarization (optional)

Without these the `.dmg` still works but triggers the "unidentified developer"
warning on first open. With them, tauri-action notarizes automatically:
`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.

To base64-encode a file for a secret:
`base64 -i Certificates.p12 | pbcopy`

---

## 5. First-release checklist (one-time)

1. Generate the updater key and add the two `TAURI_SIGNING_*` secrets — see
   [DESKTOP_AUTO_UPDATE.md](./DESKTOP_AUTO_UPDATE.md).
2. Put the public key into `tauri.conf.json` → `plugins.updater.pubkey` (replace
   `REPLACE_WITH_UPDATER_PUBLIC_KEY`) and commit it.
3. Link `apps/mobile` to the correct EAS project (`eas init` from
   `apps/mobile`) and commit the resulting `extra.eas.projectId` if EAS adds one.
4. Configure EAS remote credentials and submit credentials for the mobile app.
5. Tag `desktop-v0.5.0` (or your next version) and push. Verify the desktop job produces
   a Release with `Type_*.dmg`, `*.app.tar.gz`, `*.app.tar.gz.sig`, and
   `latest.json`, and that an older install sees the update.
6. Tag `mobile-v0.2.0` (or your next mobile version) and push. Verify App Store
   Connect shows the build in TestFlight after processing.

---

## 6. Later: dedicated macOS runners (e.g. getmac.io / self-hosted)

Out of scope for now — high-level only. When free minutes stop being enough and
local builds get tedious, point the macOS job at a faster/cheaper runner:

- **Self-hosted / third-party macOS runner** (getmac.io, MacStadium, a Mac mini):
  register it as a GitHub self-hosted runner with a label like `macos-getmac`,
  then change `runs-on: macos-latest` → `runs-on: [self-hosted, macOS, macos-getmac]`
  in the `desktop` job. Everything else (steps, secrets) stays the same.
- Pre-install Node, Rust, and Xcode on the runner image so jobs skip toolchain
  setup; keep `swatinem/rust-cache` for incremental Rust builds.
- Persisted signing material can live in the runner's Keychain instead of
  importing certs each run — or keep using the secrets for reproducibility.
