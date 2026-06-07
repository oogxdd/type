# Releasing — versioning, platform selection & CI

This repo holds **one app** with two distribution targets that live on a **single
version line**: macOS desktop (Tauri, auto-updates in-app) and iOS (App Store +
OTA JS bundles). You can release **both at once, or just one platform** at a time.

- The **git tag is the release trigger and the source of truth for the version.**
  You don't have to commit a version bump — tagging *is* the release. CI reads the
  version out of the tag and writes it into `package.json` + `tauri.conf.json`
  before building. (The version committed in the repo is just the dev baseline.)
- See also: [DESKTOP_AUTO_UPDATE.md](./DESKTOP_AUTO_UPDATE.md) for the desktop
  updater internals and one-time signing-key setup.
- For future Mac App Store / TestFlight releases, see
  [MACOS_APP_STORE_TESTFLIGHT.md](./MACOS_APP_STORE_TESTFLIGHT.md).
- For the local iOS/TestFlight upload flow, see
  [IOS_TESTFLIGHT_LOCAL.md](./IOS_TESTFLIGHT_LOCAL.md).

---

## 1. Versioning model

**One monotonic version for the whole app.** Every release increments the number,
and the tag says which platform(s) ship. Numbers are not required to be contiguous
per platform — that's expected and fine:

```
v0.5.0          both        desktop 0.5.0 + iOS 0.5.0
v0.5.1-desktop  desktop     desktop 0.5.1   (iOS stays on 0.5.0)
v0.5.2-ios      iOS         iOS 0.5.2       (desktop stays on 0.5.1)
v0.6.0          both        desktop 0.6.0 + iOS 0.6.0
```

Each built artifact carries its own version baked in at build time, so a
platform that "skipped" a number is still internally consistent. The rule of
thumb: **bump the number on every release; pick the platform with the suffix.**

### Tag conventions

| Tag pattern        | Builds                          |
| ------------------ | ------------------------------- |
| `vX.Y.Z`           | **both** desktop + iOS          |
| `vX.Y.Z-desktop`   | desktop only (.dmg + updater)   |
| `vX.Y.Z-ios`       | iOS only (App Store)            |

> Why this works for the desktop updater: the updater reads
> `…/releases/latest/download/latest.json`, so the desktop release must be
> GitHub's *latest* release. The workflow forces that for desktop/both releases
> and **never marks iOS-only releases as latest**, so an iOS release can't break
> the desktop update channel.

### iOS has two release paths

- **OTA (JS only)** — fast path for frontend-only changes. Push to `main` →
  `deploy-pages.yml` rebuilds the OTA bundle → the installed app fetches it. No
  App Store review, no tag needed.
- **Native (App Store)** — needed when Rust/native code or native deps change.
  This is the `-ios` / `both` tag path below.

---

## 2. How to cut a release

### Option A — push a tag (normal path)

```bash
git checkout main && git pull          # release from main
npm version 0.5.0 --no-git-tag-version  # optional: keep repo baseline in sync
git commit -am "Release 0.5.0" || true

git tag v0.5.0                          # both platforms
#   git tag v0.5.0-desktop              # desktop only
#   git tag v0.5.0-ios                  # iOS only
git push origin v0.5.0
```

CI ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) parses
the tag and runs only the platform jobs it selects.

### Option B — manual run (no tag)

Actions tab → **Release** → **Run workflow** → enter version + pick
`both`/`desktop`/`ios`. Useful for re-running a failed build.

### Option C — build locally (the free-tier fallback)

GitHub's free macOS runners are limited (minutes reset monthly; macOS minutes
bill at 10× the included pool, so you get relatively few builds). When you run
out, build on your Mac with the **same result**:

```bash
# desktop needs the updater signing key in the environment:
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/type-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password>"

scripts/release-local.sh 0.5.0 desktop   # or: ios | both
```

It bumps the version, builds, signs, assembles `latest.json`, and creates the
GitHub Release via `gh` — exactly what CI does. (`gh auth login` required once.)

---

## 3. Required GitHub secrets

Add under **Settings → Secrets and variables → Actions**.

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

### iOS (required for the iOS job)

| Secret                            | What it is                                                |
| --------------------------------- | --------------------------------------------------------- |
| `APPLE_IOS_CERTIFICATE_P12`       | Base64 of your distribution `.p12` cert                   |
| `APPLE_IOS_CERTIFICATE_PASSWORD`  | Password for the `.p12`                                   |
| `APPLE_IOS_PROVISIONING_PROFILE`  | Base64 of the App Store `.mobileprovision`                |
| `APPLE_ASC_API_KEY_P8`            | Base64 of the App Store Connect API key `.p8`             |
| `APPLE_ASC_API_KEY_ID`            | Key ID (e.g. `W2Y52J5N33`)                                |
| `APPLE_ASC_API_ISSUER_ID`         | Issuer ID (UUID)                                          |

> ⚠️ Your current `package.json` `ios:push` script has the API key ID and issuer
> baked in as plaintext and a hardcoded local `.ipa` path. For local release, use
> env vars plus dynamic `.ipa` discovery instead. The workflow's upload step
> already does this.
>
> iOS code-signing in CI is fiddly — expect to iterate on the provisioning
> profile / export options the first time. The macOS desktop job is the
> low-risk one to validate first.

For local iOS/TestFlight uploads, set a unique build number before each build:

```bash
export TAURI_IOS_BUILD_NUMBER="$(date +%s)"
```

The build number is what App Store Connect uses to distinguish uploads with the
same version.

Put the App Store Connect API key where `altool` can find it:

```text
~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
```

`APPLE_ASC_API_KEY_ID` is the key ID, not the `.p8` contents. `altool` uses the
key ID to locate the matching private key file.

To base64-encode a file for a secret:
`base64 -i Certificates.p12 | pbcopy`

---

## 4. First-release checklist (one-time)

1. Generate the updater key and add the two `TAURI_SIGNING_*` secrets — see
   [DESKTOP_AUTO_UPDATE.md](./DESKTOP_AUTO_UPDATE.md).
2. Put the public key into `tauri.conf.json` → `plugins.updater.pubkey` (replace
   `REPLACE_WITH_UPDATER_PUBLIC_KEY`) and commit it.
3. (iOS) Add the Apple secrets above.
4. Tag `v0.5.0` (or your next version) and push. Verify the desktop job produces
   a Release with `Type_*.dmg`, `*.app.tar.gz`, `*.app.tar.gz.sig`, and
   `latest.json`, and that an older install sees the update.

---

## 5. Later: dedicated macOS runners (e.g. getmac.io / self-hosted)

Out of scope for now — high-level only. When free minutes stop being enough and
local builds get tedious, point the macOS jobs at a faster/cheaper runner:

- **Self-hosted / third-party macOS runner** (getmac.io, MacStadium, a Mac mini):
  register it as a GitHub self-hosted runner with a label like `macos-getmac`,
  then change `runs-on: macos-latest` → `runs-on: [self-hosted, macOS, macos-getmac]`
  in the `desktop` and `ios` jobs. Everything else (steps, secrets) stays the same.
- Pre-install Node, Rust, and Xcode on the runner image so jobs skip toolchain
  setup; keep `swatinem/rust-cache` for incremental Rust builds.
- Persisted signing material can live in the runner's Keychain instead of
  importing certs each run — or keep using the secrets for reproducibility.

Ping me when you pick a provider and I'll write the exact runner config + an
updated workflow.
