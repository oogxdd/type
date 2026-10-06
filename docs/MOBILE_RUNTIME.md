# Mobile responsiveness and draft ownership

The mobile shell owns drafts in `MobileRuntime`, outside screen lifetimes.
Opening Settings/Sync or opening the menu dispatches navigation immediately;
saving happens separately. A failed save retains the draft and offers Retry
save / Save a copy through the application notice. Finishing a page still waits
for its durable save before replacing that page.

## Boundaries

- `state/mobile-lifecycle.ts` owns boot, profile changes, AppState and deferred
  auto-lock subscriptions. Stores communicate through runtime callbacks rather
  than importing each other to trigger sync and note refresh.
- Workspace tokens identify profile + root + generation. Native calls remain
  tracked until their real promises finish. Changing a root closes admission,
  flushes drafts, drains admitted operations, then changes the native root.
  Editing is temporarily disabled during this specific transition.
- Saving and preview publication are separate promises. Pull does not wait for
  preview rebuilding before push. Git history and audio maintenance run apart
  from the foreground sync action. Edits made during sync remain owed.
- The editor uses a native uncontrolled TextInput. Keystrokes update the draft
  ref; React updates for page replacement or empty/nonempty controls.
- A per-touch press gate cancels only the touch that became a swipe. No JS
  handler reads a Reanimated shared value to decide whether Settings can open.
  The existing gesture owner, thresholds, direction rules and animation timings
  stay in place; a pending manual recognizer fails on touch release.
- Preview indexes mutate internally and publish per-folder revision counters.
  Consumers must subscribe to those counters, not Map identity. Feed computation
  pauses when its menu is hidden or its route is unfocused. The worker scheduler
  admits one job at a time and coalesces queued feed requests; section splices
  transfer changed rows instead of a complete populated date section.

## Native durability and security

`read_note_for_editing`, `write_note_checked` and `delete_note_checked` compare
the exact decrypted saved body in a per-root worktree critical section. The
baseline includes intentional whitespace. Marker-only frontmatter changes do
not conflict; changed/deleted bodies do. This currently sends a body baseline
through UniFFI, rather than an opaque hash. Frontmatter is still handled by the
shared codec and unknown fields remain intact.

Git fetch/upload happens outside the shared worktree mutex; branch preparation,
commit and checkout/merge happen inside it. This serializes in-process mutations,
including mobile editor saves. It is not a cross-process filesystem lock.

Before locking, drafts flush. If a save fails, native `seal_draft` encrypts the
session snapshot in memory before plaintext shell buffers are discarded.
`open_draft` accepts encrypted data only and restores it after unlocking the
same workspace. Panic reset discards recovery state. No recovery plaintext is
written to disk; process termination can still lose a draft that could not be
saved. Existing encrypted preview snapshot restrictions remain in force.

Audio/photo import uses native file paths, and playback resolves a native local
file. The JS bridge no longer carries base64 for these flows. Source imports
are confined to the application container. A failed recording save can be
retried from the microphone while that screen remains mounted.

The OS background deadline and native job lifetime are separate: expiration
releases iOS background time but does not admit a duplicate sync or release its
auto-lock hold while the original operation still runs.

## Verification and measurements

Unit checks cover delayed writes/publication, workspace admission/draining,
failed saves and encrypted recovery, single-touch cancellation, worker deltas
at 10,000 notes, external edit/delete conflicts, file import and background
expiration. Fixtures use synthetic temporary profiles.

Verified on 2026-10-05: 189 mobile tests, 10 mobile-core tests and both TypeScript
typechecks; 104 core tests and the FFI end-to-end scenario (including unified
sync and empty-remote initialization). Rust tests requiring loopback sockets ran outside
the filesystem sandbox. Release iOS device/simulator bindings were regenerated,
and the arm64 Type Dev Release/XCTest build succeeded. After the incremental
sync follow-up, the Type Dev arm64 Release simulator app also compiled against
the regenerated unified-sync bridge; the UI cases were not rerun for that
follow-up, whose coordinator/tree behavior is covered by the functional tests.

Before the incremental sync follow-up, native case-level results passed in separate batches: 100 Settings round trips
with exact draft retention, cold loading at 1k/5k/10k, and swipe-right open /
swipe-left close followed by one toolbar tap. The main batch's report includes
an earlier swipe harness failure because its directions were reversed; the
corrected swipe case passed separately. XCTest elapsed time includes automation
overhead and is not a physical-device responsiveness measurement.

```sh
npm run test -w @typenotes/mobile -w @typenotes/mobile-core
npm run typecheck -w @typenotes/mobile -w @typenotes/mobile-core
cargo test -p type-core --lib -p type-ffi --offline
IPHONEOS_DEPLOYMENT_TARGET=16.4 npm run codegen:ios:release -w @typenotes/mobile-core
```

New native exports require a native rebuild. Regenerate Android bindings when
building Android. Codegen overwrites the committed demo package entry; restore
the fallback only after native bundling/testing is complete.

### Native iOS harness

`TypeResponsiveness` builds Release, targets **Type Dev** and launches XCTest
against the real native bridge. Its native fixture API rejects production bundle
IDs, invalid UUIDs/counts and roots outside its dedicated cache directory.
Fixtures have 1,000 / 5,000 / 10,000 notes; native-call admission is artificially
delayed 750ms for saves and summaries. Tests tap Settings without retries and
check draft retention through 100 round trips. Fixtures do not use personal data.

After Expo prebuild, reapply the target:

```sh
node apps/mobile/scripts/configure-responsiveness-tests.cjs
xcodebuild test -workspace apps/mobile/ios/Type.xcworkspace \
  -scheme TypeResponsiveness -configuration Release \
  -destination 'platform=iOS Simulator,id=<dedicated-simulator-uuid>' \
  -derivedDataPath /tmp/type-mobile-responsiveness-build \
  TYPE_APP_BUNDLE_IDENTIFIER=com.typenotes.mobile.dev \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO
```

Settings → Diagnostics → Record responsiveness exports a bounded memory trace
of UI-touch delivery to JS, JS timer stalls, menu press feedback and navigation
dispatch → navigation state changes. It contains no note content or paths.
XCTest tap timings include XCTest's own idle waits, and JS state timing does not
measure rendered frames. Neither proves a physical iPhone p95 feedback target
of 100ms or navigation-start target of 150ms. Measure those with Instruments on
the installed Release build; check swipe feel, IME/caret and keyboard behavior
there too. Android and physical iPhone workflows need platform verification.

## Incremental sync follow-up

Configured mobile boot no longer occupies the sync slot with `getGitStatus`.
The rebuilt native `git_sync_cycle` applies connection metadata without a
preliminary worktree scan, authenticates/fetches, commits local edits, merges,
sends only if the branch differs from the fetched remote, then returns one
final status. Local commit detection and the final scan still traverse Git's
worktree; this is not a filesystem journal or a claim of zero full scans.
History loading, previews and audio are outside the send path. Old native
modules retain the existing pull/push fallback until rebuilt.

`changed_paths` is a Git tree diff **after the local commit and before/after
remote application**. Local-only commits therefore do not trigger preview
rebuilding. Moves are removal + addition, and conflict siblings are included.
The result also contains body-free changed note versions/removals and ancestor
folder existence/order files. `notes-store.applySyncChanges` reads only compact
summaries of affected visible notes, applies the tree patch, and keeps other
preview objects. It does not list/stat every unchanged Stream note. Hidden
system folders remain hidden. First load, branch/bootstrap transitions and
concurrent structural local mutations use full refresh for reconciliation.
Per-path read revisions reject older compact reads; workspace/security guards
reject late results. A summary failure falls back to reconciliation.

Edits arriving after the native commit stay dirty and owe another cycle rather
than a second commit during send. Successfully received changes are published
even if send later fails, while the sync state remains unsuccessful. The
fast-forward helper installs its target tree before moving HEAD, preserving the
old checkout baseline and ensuring incoming files actually appear on disk.

Audio uses an independent serialized archive and a transport snapshot pinned
to its starting computer. The shared `CLIENT` lock is released before pairing,
hashing and transfer; a separate audio connection prevents re-pairing or audio
failure from rerouting bytes/resetting the text tunnel. Local Git exclusion
changes use the short worktree critical section. Audio scanning/hashing itself
is still full maintenance and is not a changed-recording journal.

The typing debounce remains 45 seconds. Persistent retry scheduling and desktop
notifications are subsequent work, alongside desktop push-received UI events
and moving its audio/OCR scans off the polling path. No physical-phone sync
latency has been measured here; local file-transport fixture times are not an
estimate for Iroh or iOS storage.

## Decision rationale and agent entry points

The reported failure was a Settings tap doing nothing while notes loaded or
synced. There were two separate causes to address: press admission could discard
an otherwise valid tap, and JS/navigation work competed with saving and list
publication. Faster Git alone would not fix either path. Navigation now
expresses the user's intent immediately; durability and publication have their
own completion/error state. A page commit still waits for durability because
replacing the page before its save succeeds could discard its only draft.

| Decision | Why this boundary exists | Start here |
| --- | --- | --- |
| Application-owned drafts | Navigation can unmount a screen before its save finishes. Keeping `NotePages` in the runtime makes draft lifetime independent of screen lifetime and lets failures retain text. | [mobile-runtime.ts](../apps/mobile/src/lib/mobile-runtime.ts), [note-pages.ts](../apps/mobile/src/lib/note-pages.ts), [capture.ts](../apps/mobile/src/lib/capture.ts) |
| Workspace tokens **and** draining | A token can reject an old result, but cannot stop an already admitted native call from running against process-global environment state. Root changes close admission and wait for actual promises before repointing native state. Deferred refresh starts after admission reopens. | [mobile-lifecycle.ts](../apps/mobile/src/state/mobile-lifecycle.ts), [raw-core.ts](../packages/mobile-core/src/raw-core.ts), [mobile-runtime.test.ts](../apps/mobile/src/lib/mobile-runtime.test.ts) |
| Native uncontrolled editor | Sending the whole text back through React on every keystroke adds rendering work and gives React another opportunity to replace native text/selection. The session ref owns current text; page changes explicitly replace the native input. IME/caret feel still needs device testing. | [capture-screen.tsx](../apps/mobile/src/screens/capture-screen.tsx) |
| Touch-specific cancellation | A timed suppression window can reject the next legitimate tap when JS delivery is delayed. A monotonically identified touch lets a recognized swipe cancel its own tap without suppressing a later one. The pending recognizer must fail on release so a plain tap is delivered. | [press-gate.ts](../apps/mobile/src/lib/press-gate.ts), [home-screen.tsx](../apps/mobile/src/screens/home-screen.tsx), [GESTURES.md](../apps/mobile/GESTURES.md) |
| Save baseline checked natively | A JS read followed by a write leaves a race with Git checkout. Comparing the last saved body and writing/deleting under the same root lock protects the draft from overwriting a changed/deleted note. Body comparison deliberately excludes marker-only frontmatter changes. | [notes.rs](../crates/type-ffi/src/notes.rs), [workspace.rs](../crates/type-core/src/application/workspace.rs), [tests.rs](../crates/type-ffi/src/tests.rs) |
| Normalized previews plus revision subscriptions | Copying a large preview Map for every bounded batch creates work proportional to the library. Internal indexes mutate, while affected-folder revisions notify subscribers. Reading Map identity alone will miss updates. Worker section splices similarly avoid transferring an entire large date section after one edit. | [notes-store.ts](../apps/mobile/src/state/notes-store.ts), [note-job-scheduler.ts](../apps/mobile/src/lib/note-job-scheduler.ts), [note-processing.ts](../apps/mobile/src/lib/note-processing.ts), [use-feed-sections.ts](../apps/mobile/src/lib/use-feed-sections.ts) |
| One sync coordinator | Preparing the connection and status separately for pull and push repeats work. One workflow owns admission and final status; callers join it. Fetch authenticates before local commits so repeated offline attempts do not manufacture a commit for every autosave. | [sync-store.ts](../apps/mobile/src/state/sync-store.ts), [git_sync.rs](../crates/type-core/src/application/git_sync.rs), [git adapter](../crates/type-core/src/adapters/git/mod.rs) |
| Remote-application diff | Comparing HEAD before the entire cycle confuses a local commit with incoming changes. Diffing the committed local tree against the merged tree identifies what remote application actually changed, including conflict siblings. Ancestor order patches preserve user-folder ordering without statting every unchanged note. | [git adapter](../crates/type-core/src/adapters/git/mod.rs), [sync-note-tree.ts](../apps/mobile/src/lib/sync-note-tree.ts), [notes-store.test.ts](../apps/mobile/src/state/notes-store.test.ts) |
| Short worktree locks; separate audio transport | Filesystem mutation needs serialization, but holding its lock during network waits stalls saves. Likewise, putting audio on a JS background promise does not help text sync if native audio still owns `CLIENT`. Audio snapshots retain their runtime and pin their computer before releasing that lock. | [iroh_sync.rs](../crates/type-core/src/adapters/iroh_sync.rs), [pre-suspend-sync.ts](../apps/mobile/src/state/pre-suspend-sync.ts) |

The exact-body baseline is a correctness-first bridge contract. An opaque
revision could reduce bridge traffic, but must still distinguish body changes
from marker changes and be checked atomically with the mutation. Preserve
whitespace and the shared codec's separator semantics when changing it. The
worktree lock only protects cooperating in-process operations; do not treat it
as protection against arbitrary external filesystem writers.

The incremental path assumes a held tree for the current readable workspace.
Bootstrap, branch changes and concurrent structural mutations invalidate that
assumption, so full reconciliation is intentional there. A failed send does
not undo an already successful merge: publish the received delta, report the
send failure, and retain retry state. A save after the cycle's commit belongs
to the next cycle; adding a second implicit commit during send would make its
coverage harder to reason about.

Recovery remains session-only ciphertext because plaintext recovery and
persisted decrypted previews would violate encrypted-body storage rules.
Process death can therefore lose a draft whose durable save failed. OS
background-time expiration also does not imply that native work has ended;
keep the operation/auto-lock hold until that real work settles. Native file
media avoids large base64 strings and their copies on JS, but does not make
transcription or upload instant.

Preserve the functional regression tests around these boundaries when changing
them. Diagnose latency by phase before tuning the 45-second typing debounce:
coalescing frequency, Git worktree cost, transport latency, preview publication
and rendered-frame responsiveness are different measurements. The synthetic
Release UI tests establish tap delivery and draft retention; they do not
establish a physical-device p95 latency or validate the full IME experience.

## Mobile recording follow-up (2026-10-06)

`RecordingSession` separates native capture from durable import. A foreground
recorder is prepared without prompting once microphone permission exists. A tap
on the prepared mic calls native record in that handler; Stop synchronously
pauses capture and changes the button/timer before awaiting native finalization.
The first permission prompt and a tap before preparation completes still require
OS/setup time. Completed imports run independently, so another recording can
start while a previous clip is saving. Recording/import holds are counted;
finishing one clip cannot auto-lock or repoint a workspace beneath another.
Home's recorder owns the shared audio session; mounting an inline player no
longer disables a prepared recorder or stops an active clip.

Audio goes into Documents (ExpoAudio on iOS, Audio on Android) instead of evictable cache, as supported
by [Expo's recording API](https://docs.expo.dev/versions/latest/sdk/audio/).
Before record begins, a small local journal pins its source to the profile ID
and notes root. An immutable entry and separate saved receipt avoid unlinking
the only recovery record during updates. Home recovers pending imports for its
own unlocked workspace on mount. Failed imports retain source audio and offer
mic retry. Successful imports remove only their temporary source, after core
has copied audio and written its note; synced attachments are never evicted here.

On iOS, every import takes its own background task before native Stop, independent
of the pre-suspend sync task. OS expiration still bounds available time; if a
save cannot finish before suspension/termination, its journal allows retry on
the next launch. This is eventual recovery rather than an unlimited background
execution guarantee. A crash between core's successful write and the saved
receipt can produce a duplicate note on recovery; core import does not yet have
an idempotency key. The original audio remains available through that window.

New iOS recordings use 24 kHz mono 16-bit PCM WAV (about 173 MB/hour). This is
larger than AAC but allows recovery without a finalized compressed container.
`RecordingRecovery` repairs RIFF/data lengths from persisted samples, preserves
unknown padded chunks, trims an incomplete PCM frame, and refuses invalid/empty
input without deleting it. On next launch this recovers a clip interrupted by
process death or battery shutdown; samples not yet flushed by OS/hardware may
be lost. Android retains AAC and gets the durable journal, but unfinished AAC
recovery after abrupt power loss is not provided. Background recording is
explicitly enabled in the Expo plugin and audio mode.

Verified: 202 mobile tests, mobile TypeScript typecheck, all RecordingActivity
Swift sources typechecked against installed Expo dependencies for arm64 iOS
Simulator, and the standalone Swift recovery suite. The latter writes a real
Core Audio WAV in a child process, exits without closing its writer, repairs the
file, and reads all 4096 frames back through AVAudioFile; it also covers padded
chunks, incomplete frames, repeat repair, and retaining invalid/empty files.
No physical iPhone shutdown/background deadline test, Android native build, or
end-to-end desktop Whisper/sync run was performed. A native rebuild (including
pod install to register the new Swift source, and Android prebuild for its
foreground-service declarations) is required; an OTA update alone is insufficient.

```sh
npm run test -w @typenotes/mobile
npm run typecheck -w @typenotes/mobile
sh apps/mobile/modules/recording-activity/tests/test-recovery.sh
```
