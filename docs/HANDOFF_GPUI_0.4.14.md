# Handoff: GPUI 0.4.14 release — completed

Updated: **2026-11-09 08:30 UTC** (12:30 Asia/Tbilisi).

**Published successfully. No release work remains. Do not republish or rebuild
this version.** The user asked to continue; the running candidate job was never
cancelled and completed successfully.

## Final outcome

- Public release: https://github.com/oogxdd/type/releases/tag/gpui-v0.4.14.
- Universal candidate run `42541710814`: success. Apple accepted app submission
  `3655f263-48a5-4ce2-84ea-79e63c1ffb8a` and DMG submission
  `a767cc89-7d07-4ae8-bb42-7b364ed57581`.
- Promotion run `42586170786`: success, rollout interval `0`.
- Actual downloaded candidate passed manifest/source/checksum, Sparkle feed and
  archive signatures, Developer ID, both Apple staples, Gatekeeper, both Mach-O
  slices and updater plist checks. Its isolated Unicode/save/normal quit/reopen
  smoke passed; log `.tmp/release-smoke-0.4.14-ci.log`.
- Both GitHub-downloaded and public-URL live feeds passed signature checks and
  describe 0.4.14 with the correct universal DMG URL and immediate rollout.
  Legacy GitHub latest remains `desktop-v0.8.1`.
- DMG SHA-256:
  `248b4e783e64873613032ba8c57d7bd21fb9c1e7dd128d3febdbdf1afd561ee3`.
- Canonical RELEASING.md now incorporates the execution path, credential
  inventory/API-key recovery, architecture/producer choice, actual-candidate
  verification and limits of active-job monitoring (not just this release report).
- Local Apple profile was restored using the existing API key. Release caches
  are retained. Some obsolete session-generated test executables and bundles
  were removed when disk space ran out during candidate copying; about 400 MiB
  remained after cleanup. Address disk capacity before another local build.
- Production updater installation/UI feel and physical Intel execution remain
  for manual review; no user application was restarted for publication.

The following sections preserve the **01:11 UTC pre-publication snapshot** and
commands used for diagnostics. They are historical context, not pending work.

## User authorization and scope

The user requested implementing the writing timer, Cmd+/ palette alias and a
line-number palette command, then requested a new build/release and publishing
an update. They explicitly confirmed pushing all nine accumulated commits
through `2fa91d8` to main and publishing 0.4.14, including the existing desktop
Markdown and mobile/iOS changes. That push is complete. Subsequent changes are
release documentation only. Do not ask again for that authorization.

An initial automatic review rejected the broad main push before confirmation;
the user then answered: “Да, отправить все 9 коммитов и опубликовать”. This is
resolved, not an outstanding approval. No PR or additional merge is needed.

Only the macOS desktop app is being distributed. The current release notes
correctly describe **universal** (Apple Silicon + Intel); Intel runtime has not
been tested on physical hardware. The first local attempt was arm64, but the
existing CI candidate workflow builds universal.

## Source, worktrees and jobs at the original snapshot

- Repository: `oogxdd/type` (`https://github.com/oogxdd/type`).
- Project: `/Users/digital/Projects/type`.
- Persistent release worktree: `.worktrees/gpui-release-0.4.14`, branch `main`.
- Feature commit: `ea95979` — writing timer and palette shortcuts.
- Version/release preparation: `2fa91d8`.
- **Immutable release tag:** `gpui-v0.4.14`, commit
  `cedc84e070e2ef0a866e2e58c936fa3fc0e10eab`.
- Tag commit adds only documentation to `2fa91d8`; Rust source/lock are the same.
- Main may be ahead of the tag with this handoff/status documentation. Do not
  move/recreate the tag or replace a candidate's artifacts.
- Ordinary CI: [42541204658](https://github.com/oogxdd/type/actions/runs/42541204658),
  **success** for TypeScript, Linux Rust workspace and native macOS GPUI.
- **Active candidate:** [42541710814](https://github.com/oogxdd/type/actions/runs/42541710814).
  Job ID `128917869853`, runner `macos-15`.
- Candidate Functional checks: **success**, 00:43:45–01:00:23 UTC.
- Developer ID import and baseline feed read: **success**.
- Current step: **Build signed and notarized universal candidate**, started
  **01:00:26 UTC**, still `in_progress` at this snapshot.
- `gh release view gpui-v0.4.14` still reported **release not found** at 01:11 UTC.
  No draft or live feed update yet.

The main worktree contains the documentation for this handoff. After committing
it, the root feature checkout can be fast-forwarded to main so a successor finds
these files at the usual root. Keep both checkouts clean. Local `.worktrees/`
is excluded through `.git/info/exclude`; do not create temporary worktrees.

## What passed locally

Outside the sandbox, the required release checks all passed:

- GPUI: 45 library + 64 binary tests, including recording playback.
- Core: 118 library tests.
- Release/updater Python scripts: 19 tests.
- Optimized arm64 compilation completed in 6m18s; Developer ID signing passed.
- Signed arm64 app functional smoke on a synthetic profile: Unicode text saved,
  normal Cmd+Q, relaunch and exact persisted text all passed.
- Ordinary remote CI also passed on the same Rust source.

Earlier sandbox-only audio failures were environmental: the full release test
run outside the sandbox passed that test. Do not skip tests or change audio code.

The local smoke harness is `.tmp/release-smoke-0.4.14.py`; its successful log is
`.tmp/release-smoke-0.4.14.log`. It currently points at `target/bundle/Type.app`
and uses `.tmp/release-smoke-0.4.14-direct-quit`. Its test root already exists;
use a fresh root if rerunning. Unicode and Cmd+Q use CoreGraphics events targeted
to the exact synthetic process PID. AppleScript Unicode/Cmd+Q was unreliable;
AX window lookup also failed for GPUI. Do not infer a product failure from those
AppleScript attempts. Never send these events to the user's production process.

## Apple credential recovery — important discovery

The first local packaging attempt stopped at notarization with exit 69:
`No Keychain password item found for profile: type-gpui-notary`.
The preflight had reported success; this did not establish upload-time access.
Explicit login Keychain queries and the named Apple ID/password services were
absent. The user asked for a wider search instead of re-entering credentials.

**A working existing team App Store Connect API key was found**, at the path
and with the key/issuer identifiers already documented in
[mobile local TestFlight instructions](../apps/mobile/LOCAL_TESTFLIGHT.md).
The key is also present under `~/private_keys/`. Do not print its contents.

`notarytool history --key … --key-id … --issuer …` succeeded and listed the
same team's previous desktop notarizations. The local profile was restored with
`notarytool store-credentials type-gpui-notary` using those API-key options.
Subsequent profile history and `release_local.py --check --architecture arm64`
both passed. **Local notarization credentials are now available.** No new secret
was entered, rotated, printed, committed or uploaded.

Keep CI as the sole producer for the current universal candidate; do not start a
competing build/draft. The restored local profile is useful for monitoring and
future/recovery work. [RELEASING.md](RELEASING.md) now records this recovery path.

## How to monitor without claiming a job is healthy from its status

```sh
gh run view 42541710814 --repo oogxdd/type --json status,conclusion,jobs

gh release view gpui-v0.4.14 --repo oogxdd/type --json isDraft,isPrerelease,url,assets

xcrun notarytool history --keychain-profile type-gpui-notary --output-format json
```

- The job's `updated_at` can stay at its original start even when steps advance;
  it is not a heartbeat.
- REST job logs return 404 while the job is running. `gh --log` is available
  after completion. Direct step-log endpoints also returned 404 with gh auth.
- The public GitHub job page requires web login for live logs. No browser session
  was available. Do not keep retrying these endpoints or extract browser cookies.
- Therefore CPU/compiler progress inside the combined packaging step was **not
  proven**. Its duration alone does not establish either progress or a hang.
- Apple history is an independent progress signal: a new `Type.zip` submission,
  then `Type-0.4.14-universal.dmg`, indicates arrival at notarization.
- At 01:08 UTC, history still ended at 0.4.13 (`110bbd42-9930-44d3-b35e-0d87340fbad3`,
  accepted DMG); there was no new submission from this build yet.
- Existing bounds: candidate job 90 minutes; combined packaging step 65 minutes;
  each Apple upload 5 minutes, processing 20 minutes. Step started 01:00:26 UTC.
- User explicitly asked not to cancel the job. Monitor it; if it fails, inspect
  completed logs and Apple history before retrying uploads or builds.

Once the job finishes:

```sh
gh run view 42541710814 --repo oogxdd/type --log > /private/tmp/type-gpui-0.4.14-ci.log
```

## Verification/publication procedure used (completed; do not repeat)

1. Wait for the active candidate workflow to finish successfully and create its
   draft. There should be exactly these candidate assets:
   `Type-0.4.14-universal.dmg`, `appcast.xml`, `release.json`.
2. Download into a fresh directory, e.g. `/private/tmp/type-release-0.4.14-ci`:

   ```sh
   gh release download gpui-v0.4.14 --repo oogxdd/type --dir /private/tmp/type-release-0.4.14-ci
   ```

3. Check manifest version `0.4.14`, architecture `universal`, bundle ID
   `com.digital.type2`, commit `cedc84e070e2ef0a866e2e58c936fa3fc0e10eab`, and
   SHA-256 of the downloaded DMG. Compare manifest baseline with the current
   native feed if needed; promotion checks it again.
4. Verify DMG code signature and staple:

   ```sh
   codesign --verify --strict /private/tmp/type-release-0.4.14-ci/Type-0.4.14-universal.dmg
   xcrun stapler validate /private/tmp/type-release-0.4.14-ci/Type-0.4.14-universal.dmg
   /private/tmp/type-sparkle/bin/sign_update --account type-gpui --verify /private/tmp/type-release-0.4.14-ci/appcast.xml
   ```

   `sign_update --account type-gpui` reads the existing Sparkle key from Keychain;
   **no private-key export is needed for manual verification**. Extract the
   0.4.14 enclosure's EdDSA signature from the XML and verify the DMG with the
   same tool (`--verify DMG SIGNATURE`). Never print/export private keys.
5. Mount the DMG read-only with `hdiutil attach -readonly -nobrowse` at a fresh
   mountpoint. Verify `Type.app` with `codesign --verify --deep --strict`,
   `stapler validate`, `spctl --assess --type execute`; inspect plist version,
   bundle ID, Sparkle configuration, signing team, and both `lipo` slices.
6. Copy the actual candidate app to a disposable persistent project test folder
   (not Applications). Run a smoke test with an explicit **fresh synthetic
   `--data-dir`**, never production notes. Adapt the existing smoke harness with
   the new app path and fresh test root. Check Unicode/save/quit/reopen. Do not
   trigger an automatic Sparkle relaunch with a data-dir override, as Sparkle may
   lose that argument. Close only the synthetic process and detach the DMG.
7. Publish through the existing promotion workflow, already authorized:

   ```sh
   gh workflow run gpui-promote.yml --repo oogxdd/type --ref main \
     -f version=0.4.14 -f operation=promote -f rollout_interval=0
   gh run list --repo oogxdd/type --workflow gpui-promote.yml --limit 3
   ```

   Wait for success. Do not manually publish the draft or replace the live feed;
   promotion verifies baseline, signatures, checksum and notarization. Do not
   overwrite candidate assets. If a GitHub environment approval is required,
   report that concrete requirement rather than treating dispatch as publication.
8. Download the live `gpui-updates/appcast.xml` and verify its signature with
   `sign_update --account type-gpui --verify`. Confirm version 0.4.14, expected
   public DMG URL and interval `0`; verify the candidate is public/non-prerelease.
   Check the public feed URL too if possible, and preserve the legacy Tauri
   `latest` release/feed. Link the published release in the final answer and
   tell the user Settings → Updates → Check for updates.
9. Update this handoff, migration status and RELEASING.md with outcome, source
   and promotion run ID/checks. Commit/push documentation. Do not restart the
   user's production app unless requested.

## Local files / caveats

- Current release notes: [gpui-v0.4.14.md](releases/gpui-v0.4.14.md).
- Local build log: project `.cargo-release-0.4.14.log` (ignored).
- Failed local intermediate `/private/tmp/type-release-0.4.14/type-gpui-release`
  and the non-notarized local `target/bundle/Type.app` were removed for space.
- Downloaded official assets remain in `/private/tmp/type-release-0.4.14-ci/`;
  the DMG is detached. Its copied smoke app `.tmp/gpui-0.4.14-ci` was removed
  after testing. Synthetic profiles and logs remain for diagnostics.
- Reuse root `target/` for future local builds; arm64 release cache is now warm.
  Intel target/cache state was not checked. Free disk fell to about 400 MiB;
  another local build needs more room. Preserve release caches where possible.
- Running dev process at last check: PID `28252`, root
  `target/bundle/Type GPUI Dev.app/Contents/MacOS/type-gpui --dev`.
- Running production process: PID `77005`,
  `/Applications/Type GPUI.app/Contents/MacOS/type-gpui`.
  Recheck PIDs before any action; neither should be quit for this release task.
- Never run two shells against the same notes root. All smoke fixtures are
  synthetic and separate. No production notes were used for tests.
