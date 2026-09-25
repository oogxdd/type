# Mobile sync timing — when the phone syncs, and why not "live"

Status: **implemented** (mobile, 2026-09-25). Relates to
[AUTO_SYNC.md](AUTO_SYNC.md) (the older orchestrator exploration) and
[IROH_SYNC_MENTAL_MODEL.md](IROH_SYNC_MENTAL_MODEL.md).

## The problem

Every automatic sync is a full Git round trip: pull, commit, push. The phone
used to schedule one **1.5 s after every save**, and the capture page saves
after each 500 ms typing pause — so writing a note produced roughly one commit
per pause, each with a network round trip, plus merge commits whenever the
desktop was writing at the same time.

The commits themselves are cheap. A text commit is a few hundred bytes; the
whole cleaned history (~390 commits) packs to about 7 MB. What bloated the
repository was audio, not commit count. The real costs are battery and latency
of a round trip per pause, and a noisy history of `Sync notes` commits.

## What the phone does now

`apps/mobile/src/lib/sync-schedule.ts` decides the delay from what happened,
not from a single constant:

| Timing | When | Delay |
| --- | --- | --- |
| `edit` | typing into a note that stays open (capture page, editor) | 45 s after the last save, but at most 3 min after the first unsynced one |
| `action` | page filed (swipe up), note closed in the editor, delete, move, archive, audio or photo saved | 1.5 s (unchanged — batches a multi-select) |
| `now` | app opened / foregrounded | immediately |

Rules: edits debounce each other; an edit never postpones an already pending
action; the 3 min ceiling keeps a long writing session from never syncing.
Retries after a failed sync keep their own backoff (`autoSyncRetryDelayMs`).

### Before the app is suspended

Timers do not run while iOS has the app suspended, so an edit waiting for its
45 s pause would otherwise stay on the phone until the next launch. On the
AppState `background` transition, `src/state/pre-suspend-sync.ts`:

1. flushes every open draft to disk (capture page and editor, via
   `lib/capture-draft.ts`);
2. runs `syncBeforeSuspend()`, which syncs only if something is owed (a pending
   timer, unsynced saves, or a sync that last failed), after joining any sync
   already in flight;
3. releases the native background task.

The time comes from `modules/background-task`, an iOS Expo module that calls
`beginBackgroundTask` **natively inside `didEnterBackground`** — not when JS
hears about it, because the AppState event reaches JS asynchronously and iOS
may already be suspending by then. iOS grants about 30 s; JS gives up after
25 s and the native expiration handler ends the task regardless, so the app is
never killed for overrunning.

While it runs it holds a background operation, which defers the encryption
auto-lock (a locked core rejects the sync); the lock applies as soon as it
settles.

### What this does not cover

- **Killed from the app switcher, crash, or phone off** before the push lands:
  the note is already on disk (drafts are flushed first); it syncs on the next
  launch. Nothing is lost, it is only late.
- **Desktop unreachable** at that moment: the sync fails quietly, the state
  becomes "Waiting for computer", and the next foreground retries.
- **Android** has no module; the same flow runs without extra time, which is
  usually enough because Android does not freeze a backgrounded app instantly.

### Deployment

The scheduling change is JavaScript and ships by OTA. The background task is a
**native module**: it needs a new native build. An OTA bundle on an older
binary finds no module and still attempts the pre-suspend sync, just without
the guaranteed window.

## Reverting

- **Back to syncing on every pause:** in `lib/sync-schedule.ts` set
  `EDIT_SYNC_DEBOUNCE_MS = ACTION_SYNC_DELAY_MS`. That is the old behavior;
  tests that pin the 45 s value will need their expectations updated. OTA is
  enough.
- **Different pause:** change `EDIT_SYNC_DEBOUNCE_MS` / `EDIT_SYNC_MAX_WAIT_MS`.
- **Drop the pre-suspend sync:** remove the `runPreSuspendSync()` call in
  `App.tsx`. The native module is then inert.

## Options considered and not taken

### A parallel live channel (Iroh) next to Git

Idea: keep Git for history, and stream the open note's current text to the
desktop over the existing Iroh connection without commits; the desktop writes
the file, later both sides commit, and Git merges identical content cleanly.

Not built because real-time mirroring is not needed — the goal is fewer
commits, not faster ones. It would also add a second write path into the
desktop's working tree that races its editor and autosave, and it only helps
while both devices are online together. Worth revisiting only if "see it on the
computer while I type" becomes a requirement; the transport already exists.

### CRDT (Automerge / Yjs)

Solves simultaneous editing of the same note on two devices. For one person
that is rare, and the existing `.conflict.md` scheme covers it. Large rework
(notes stop being plain Markdown on disk). Rejected.

### Squashing or amending sync commits

Amending a commit that already reached another device creates diverging
histories — exactly the old-clone-merges-back situation of the audio history
migration. Squashing locally before the first push would be safe but gains
little once pushes are rarer. Rejected.

### BGTaskScheduler (BGAppRefreshTask / BGProcessingTask)

Lets iOS wake the app later to sync. The OS decides when (often hours later, or
never for a rarely used app), it needs a headless JS runtime, and it cannot
replace syncing at the moment of leaving. Could be a later safety net for
"Waiting for computer"; not needed for the common case.

### Silent push notifications

Would need a server and APNs; contradicts the no-server local sync model.
