# Releasing — versioning & CI

Desktop (macOS Tauri app, auto-updates in-app) and mobile (React Native /
Expo) releases are **tag-driven** and intentionally separate.

- The **git tag is the release trigger and the source of truth for the version.**
  You don't have to commit a version bump — tagging *is* the release. CI reads the
  version out of the tag and writes it into the app config before building. (The
  version committed in the repo is just the dev baseline.)
- See also: [DESKTOP_AUTO_UPDATE.md](./DESKTOP_AUTO_UPDATE.md) for the desktop
  updater internals, and [UPDATER_KEY_ROTATION.md](./UPDATER_KEY_ROTATION.md)
  for generating or rotating the signing key.
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

Set **all six or none** — a partially configured setup fails the release rather
than falling back to unsigned. Full walkthrough, including the microphone
entitlement the hardened runtime requires:
[MACOS_CODE_SIGNING.md](./MACOS_CODE_SIGNING.md).

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

## 6. What runs when, and what it costs

| Workflow | Trigger | Runner | Builds the app? |
| --- | --- | --- | --- |
| `ci.yml` | every push to `main`, every PR commit | `ubuntu-latest` | No — typecheck + unit tests only |
| `ffi-bindings-check.yml` | PRs touching `type-ffi` / `mobile-core` | `ubuntu-latest` | No |
| `release.yml` | push of a `desktop-v*` tag, or manual dispatch | `macos-latest` | **Yes** — `.dmg` + updater artifacts |
| `mobile-testflight.yml` | push of a `mobile-v*` tag | `macos-latest` | Yes — `.ipa` |

So ordinary commits never trigger a desktop build. Only a `desktop-v*` tag does.
That matters for billing: Linux minutes count 1×, **macOS minutes count 10×**
against the included pool.

### Why the release build is always cold

`swatinem/rust-cache@v2` is in both workflows, but the release build still
compiles from scratch every time, for three independent reasons:

1. **Different operating systems.** `ci.yml`'s `rust` job runs on
   `ubuntu-latest`; `release.yml` runs on `macos-latest`. Rust caches are
   per-platform, so CI produces nothing the release job could restore. This is
   the dominant reason.
2. **Cache scoping by ref.** A tag push runs on `refs/tags/desktop-v1.2.3`.
   Actions restores from the current ref's scope, falling back to the default
   branch — so `main → tag` can work, but a cache *saved* under one tag is
   invisible to the next tag. Tag-to-tag reuse never happens.
3. **Different profiles.** `cargo test --workspace --lib` builds `debug`;
   `tauri build` builds `release`. Even on matching platforms you would reuse
   the downloaded crates, not the compiled dependencies.

### Should you fix it?

Probably not. Warming it means adding a `macos-latest` job on `main` that does a
release-profile build with a shared `shared-key`, which the tag job then
restores. That burns 10×-billed macOS minutes on every push to `main` to save
minutes on releases you cut occasionally — and Actions evicts caches after 7
days unused, so at a weekly cadence the warm cache is often gone by release time.

**Your fastest path is local.** The repo's `target/` on a dev Mac stays warm
(~12 GB), so `npm run desktop:release <version>` rebuilds incrementally in a
couple of minutes. CI is the fallback for when you're away from that machine.

If you do want it warmed, the shape is:

```yaml
# ci.yml — new job, main only
warm-desktop-cache:
  if: github.ref == 'refs/heads/main'
  runs-on: macos-latest
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
    - uses: swatinem/rust-cache@v2
      with:
        shared-key: desktop-macos-release
    - run: cargo build --release --manifest-path apps/desktop/src-tauri/Cargo.toml

# release.yml — desktop job restores it, never saves (a tag-scoped
# save can't be read by anything later)
- uses: swatinem/rust-cache@v2
  with:
    shared-key: desktop-macos-release
    save-if: false
```

### Choosing CI or local per release

Both paths produce identical artifacts and both create the GitHub Release, so
the risk is doing it twice for the same tag. The `desktop` job guards against
that: it checks whether the release already carries a `latest.json` and exits
without rebuilding if so. That makes the choice a matter of what you do first,
with no flags to remember:

- **Local:** `npm run desktop:release 1.2.3`. It builds, signs, publishes, and
  creates the tag. If that tag push wakes CI, CI sees the finished release and
  skips.
- **CI:** just push the tag — `git tag desktop-v1.2.3 && git push origin
  desktop-v1.2.3`. Nothing is published yet, so CI builds it.

Local releases still need the updater key in the environment (see
[UPDATER_KEY_ROTATION.md](./UPDATER_KEY_ROTATION.md)):

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/type-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password>"
```

---

## 7. Later: dedicated macOS runners (e.g. getmac.io / self-hosted)

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
