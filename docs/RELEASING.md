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

### Option C — build locally

CI is not rationed here: `oogxdd/type` is public, and GitHub Actions is free on
standard runners for public repositories. Build locally for *speed*, not cost —
a cold CI build takes 8–10 minutes, while your Mac rebuilds incrementally in
about two:

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

For the native Xcode build and direct App Store Connect upload used by the
GitHub-hosted macOS runner, see
[MOBILE_TESTFLIGHT_GITHUB_ACTIONS_NATIVE.md](./MOBILE_TESTFLIGHT_GITHUB_ACTIONS_NATIVE.md).

```bash
git checkout main && git pull
git tag mobile-v0.2.0
git push origin mobile-v0.2.0
```

CI ([`.github/workflows/mobile-testflight.yml`](../.github/workflows/mobile-testflight.yml)):

1. creates a metadata-only GitHub Release without changing the desktop Latest,
2. runs on a macOS runner,
3. generates the iOS UniFFI/native module from `packages/mobile-core`,
4. archives and exports an `.ipa` with Xcode, and
5. validates and uploads that `.ipa` directly to App Store Connect/TestFlight.

The workflow sets `MOBILE_VERSION` from the tag and uses the GitHub run number
as `IOS_BUILD_NUMBER`. For a manual rerun, use Actions → **Mobile TestFlight**
and optionally enter an explicit build number.

---

## 4. Required GitHub secrets

Add under **Settings → Secrets and variables → Actions**.

### Mobile (required)

The `ios` job uses the `testflight` GitHub Environment. Add the following as
environment secrets (or repository secrets if environment scoping is not
desired):

| Secret | What it is |
| --- | --- |
| `APPLE_TEAM_ID` | Apple Developer team ID |
| `APP_STORE_CONNECT_KEY_ID` | Team App Store Connect API key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | Team App Store Connect API issuer ID |
| `APP_STORE_CONNECT_PRIVATE_KEY` | Complete contents of the API key `.p8` file |

The runner creates an unsigned intermediate archive, then Xcode uses the team
API key and cloud-managed signing to export the signed IPA. A distribution
`.p12`, temporary Keychain, `EXPO_TOKEN`, and EAS-managed credentials are not
used by the native workflow.
See [MOBILE_TESTFLIGHT_GITHUB_ACTIONS_NATIVE.md](./MOBILE_TESTFLIGHT_GITHUB_ACTIONS_NATIVE.md)
for the one-time Apple and GitHub setup.

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

| Workflow | Trigger | Runners | Builds the app? |
| --- | --- | --- | --- |
| `ci.yml` | push to `main`/`master`; every PR commit, any branch — **except** changes that touch only `**.md` / `docs/**` | ubuntu ×2 | No — typecheck + unit tests |
| `ffi-bindings-check.yml` | PRs touching `crates/type-ffi/**`, `packages/mobile-core/**`, `scripts/check-ffi-surface.mjs`; manual | ubuntu (PRs); **macOS only on manual dispatch** — its `codegen` job is gated on `github.event_name == 'workflow_dispatch'` | No — surface check + codegen |
| `release.yml` | push of a `desktop-v*` tag; manual | ubuntu + **macOS** | **Yes** — `.dmg` + updater artifacts |
| `mobile-testflight.yml` | push of a `mobile-v*` tag; manual | ubuntu ×2 + **macOS** | Yes — `.ipa` → TestFlight |

Things that trigger **nothing**: pushing a branch that has no open PR, and
pushing a tag outside the `desktop-v*` / `mobile-v*` namespaces.

**Cost: none.** `oogxdd/type` is a public repository, and GitHub Actions is free
on standard runners for public repos — including `macos-latest`. The macOS
multiplier and the included-minutes pool that most guidance warns about apply to
*private* repositories. Nothing here is a reason to avoid a run; what a run
actually costs is wall-clock time and a little noise.

Documentation-only changes are skipped declaratively via `paths-ignore` in
`ci.yml`, so there is nothing to remember per commit. The filter skips a run
only when **every** changed path matches, so a commit mixing docs and code still
runs — it fails in the safe direction.

`[skip ci]` (or `[ci skip]`, `[no ci]`, `[skip actions]`) in a commit message
still works as a manual override. Avoid it for code changes: an opt-out you have
to remember gets forgotten exactly when you're in a hurry, which is when CI is
worth most.

> **The marker is matched as a plain substring, anywhere in the message —
> including the body, and including inside backticks or a quotation.** Writing
> *about* it ("replaced the skip-marker convention with `paths-ignore`") silently
> suppresses that commit's run. This bit us on the very commit that added
> `paths-ignore`. If you need to mention it in a message, break it up or say
> "skip marker". Actions → CI → Run workflow re-runs checks afterwards.

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
restores. Since the runners are free here, the cost is complexity rather than
money — an extra job on every push to `main`, plus a cache Actions evicts after
7 days unused, so at a weekly release cadence the warm cache is often gone by
the time you need it.

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
the risk is doing it twice for the same tag. The `setup` job guards against
that: it checks whether the release already carries a `latest.json`, and the
whole `desktop` job is skipped if so. The check deliberately lives in `setup`
rather than inside the macOS job, so a local release wastes seconds of CI
rather than spinning up a macOS runner to do nothing. That makes the choice a
matter of what you do first, with no flags to remember:

- **Local:** `npm run desktop:release 1.2.3`. It builds, signs, publishes, and
  creates the tag. If that tag push wakes CI, CI sees the finished release and
  skips.
- **CI:** just push the tag — `git tag desktop-v1.2.3 && git push origin
  desktop-v1.2.3`. Nothing is published yet, so CI builds it.

### Local release credentials — use the Keychain, not a dotenv

`release-local.sh` resolves everything it needs by itself, so a local release is
one command with no exports. It looks in this order: existing environment →
login Keychain → derived from the machine.

Derived for free: the updater private key from `~/.tauri/type-updater.key`, the
signing identity from `security find-identity`, and the Team ID from that
identity's `(TEAMID)` suffix.

The three actual secrets go in the Keychain once:

```bash
security add-generic-password -a "$USER" -s type-updater-key-password -w
security add-generic-password -a "$USER" -s type-apple-app-password -w
security add-generic-password -a "$USER" -s type-apple-id -w
```

`-w` with no value prompts for it, so nothing lands in shell history.

**Why not a `.env` file:** these are release-signing secrets. A dotenv is
plaintext on disk and one `.gitignore` slip from being committed, and it invites
copies to spread. Keychain items are encrypted at rest, survive across shells,
and live where the Developer ID certificate already is. Plain `export` in a
shell is worse still — it lasts only until you close the window, and typing the
password inline puts it in history.

Environment variables still win when set, so CI and one-off overrides keep
working unchanged.

If the Apple credentials are missing, the script warns and builds **unsigned**
rather than failing. Take that warning seriously: shipping an unsigned update to
people running a notarized build means macOS refuses to launch their next fresh
install.

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
