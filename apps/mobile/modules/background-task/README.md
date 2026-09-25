# background-task

iOS-only Expo module that gives Type a short window (~30 s) after it is
backgrounded, so pending notes are flushed and synced before suspension.

- The task starts natively on `UIApplication.didEnterBackgroundNotification`.
- JS (`src/lib/background-task.ts`) calls `finish()` when the pre-suspend sync
  settles; the expiration handler ends it otherwise.
- Android and builds without the module (Expo Go, an OTA bundle on an older
  binary) get a no-op: the sync is still attempted, just without extra time.

Adding or changing this module needs a native build; an OTA update is not
enough. Why and what was rejected: `docs/SYNC_TIMING.md`.
