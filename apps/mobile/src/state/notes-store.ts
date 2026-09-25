import { create } from "zustand";

import * as core from "@typenotes/mobile-core/core-api";
import { STREAM_FOLDER_PATH } from "@typenotes/shared/constants";
import { getErrorMessage } from "@typenotes/shared/errors";
import type { NotePreview } from "@typenotes/shared/format";
import type { FolderNode } from "@typenotes/shared/types";

import { collectNoteEntries, collectNotePaths, previewsByPath } from "../lib/feed";
import {
  parsePreviewSnapshot,
  serializePreviewSnapshot,
  type VersionedPreview,
} from "../lib/preview-snapshot";
import {
  deletePreviewSnapshot,
  readPreviewSnapshot,
  writePreviewSnapshot,
} from "./preview-snapshot-file";
// notes-store, sync-store and security-store reference each other, but only
// from inside action bodies (`getState()` at call time), never while any of
// them is evaluating.
import { useSecurityStore } from "./security-store";
import { activeProfile, useSettingsStore } from "./settings-store";
import { useSyncStore } from "./sync-store";

/**
 * How many notes one `list_note_previews` call may cover.
 *
 * That command returns the decrypted body of every path it is given as a
 * single JSON string: asking for a whole notes root builds that string in
 * Rust, ships it across the FFI bridge and parses it again in JS — one very
 * large allocation, on a phone, while the UI is live. Batching keeps the peak
 * bounded no matter how many notes the folder holds.
 */
const PREVIEW_BATCH = 200;

/** A freshly read preview and the file version it was read at. */
type LoadedPreview = { preview: NotePreview; version: string | null };

const collectPreviewsInto = async (
  paths: string[],
  into: Map<string, LoadedPreview>
): Promise<void> => {
  for (let index = 0; index < paths.length; index += PREVIEW_BATCH) {
    const entries = await core.listNotePreviews(
      paths.slice(index, index + PREVIEW_BATCH)
    );
    const previews = previewsByPath(entries);
    for (const entry of entries) {
      const preview = previews.get(entry.path);
      if (preview) {
        into.set(entry.path, { preview, version: entry.version ?? null });
      }
    }
  }
};

/** The working folder whose notes should be showing; null before settings load. */
const activeProfileId = (): string | null =>
  activeProfile(useSettingsStore.getState().snapshot)?.id ?? null;

/**
 * A preview is the opening text of a note, in the clear, so snapshots reach
 * the disk only while encryption is known to be off — the rule the desktop
 * applies to its persisted previews too.
 */
const snapshotsAllowed = (): boolean => {
  const security = useSecurityStore.getState().state;
  return security !== null && !security.encryption_enabled;
};

type NotesState = {
  tree: FolderNode | null;
  previews: Map<string, NotePreview>;
  /**
   * The file version each preview was read at (`NoteEntry.version`): how a
   * refresh knows which notes it may skip. Bookkeeping, not for rendering.
   */
  previewVersions: Map<string, string>;
  loading: boolean;
  error: string | null;
  /**
   * Bring the tree and previews up to date. Nothing waits for it. It reads
   * only notes whose file changed since their preview was read — on a launch,
   * since the snapshot the previous one saved — and publishes the tree first
   * (lists show placeholder rows), then the top of the Feed, then the rest.
   * Concurrent calls coalesce.
   */
  refresh: () => Promise<void>;
  /** Refresh previews for a few paths without re-reading the whole tree. */
  refreshPreviews: (paths: string[]) => Promise<void>;
  /**
   * A single note appeared (capture filed a page): reload the body-free tree
   * and only that note's preview.
   *
   * Deliberately *not* `refresh()`. `list_note_previews` returns the decrypted
   * body of every path it is given, so a full refresh ships the entire corpus
   * across the FFI bridge as one JSON string and parses it again in JS. Doing
   * that on every swipe-up made the cost of filing a page grow with the size
   * of the notes folder — on a phone that is a large, repeated allocation on
   * the JS thread while a spring animation and the keyboard are both live.
   */
  noteFiled: (path: string) => Promise<void>;

  // ── Mutations ──
  // Each one calls the core, reloads only what changed, and schedules a sync.
  // None of them calls `refresh()`: re-reading every note body after moving a
  // single note is the cost this store exists to avoid.

  /** Move notes (or folders) into `destination`, creating it if missing. */
  moveNotes: (paths: string[], destination: string) => Promise<void>;
  deleteNotes: (paths: string[]) => Promise<void>;
  /** Set the front-matter `archived_ms` marker; the note does not move. */
  setArchived: (path: string, archived: boolean) => Promise<void>;
};

let refreshInFlight: Promise<void> | null = null;
let refreshAgain = false;

// A refresh that has to read a large folder runs for seconds, in the
// background, while pages are filed and notes moved or edited. The next three
// exist so that its older reads never overwrite newer ones.

/** Tree reads, numbered as they start; only a read newer than the shown one lands. */
let treeReadsStarted = 0;
let treeReadShown = 0;
/** Paths re-read on their own while a full refresh runs: its older copy must not win. */
let rereadDuringRefresh: Set<string> | null = null;

/** The working folder the held tree and previews belong to; undefined until the first refresh. */
let heldProfileId: string | null | undefined;
/** Whether the held previews differ from the working folder's snapshot on disk. */
let snapshotStale = false;

export const useNotesStore = create<NotesState>((set, get) => {
  /** Read the tree and show it, unless a read that started later already landed. */
  const reloadTree = async (): Promise<FolderNode | null> => {
    const read = ++treeReadsStarted;
    const tree = await core.getTree();
    if (read > treeReadShown) {
      treeReadShown = read;
      set({ tree, error: null });
    }
    return get().tree;
  };

  /**
   * Merge freshly read previews into the cache as it is *now*. Replacing it
   * with a map copied before an await would drop whatever landed meanwhile —
   * the background refresh's thousands of previews included.
   */
  const mergePreviews = (
    loaded: Map<string, LoadedPreview>,
    { skip, prune = false }: { skip?: Set<string>; prune?: boolean } = {}
  ): void => {
    let changed = false;
    set((state) => {
      const previews = new Map(state.previews);
      const previewVersions = new Map(state.previewVersions);
      for (const [path, { preview, version }] of loaded) {
        if (skip?.has(path)) {
          continue;
        }
        previews.set(path, preview);
        if (version) {
          previewVersions.set(path, version);
        } else {
          previewVersions.delete(path);
        }
        changed = true;
      }
      if (prune && state.tree) {
        const live = new Set(collectNotePaths(state.tree));
        for (const path of [...previews.keys()]) {
          if (!live.has(path)) {
            previews.delete(path);
            previewVersions.delete(path);
            changed = true;
          }
        }
      }
      return changed ? { previews, previewVersions } : state;
    });
    if (changed) {
      snapshotStale = true;
    }
  };

  /** Read these previews on their own; a running full refresh will not overwrite them. */
  const rereadPreviews = async (paths: string[], prune = false): Promise<void> => {
    const loaded = new Map<string, LoadedPreview>();
    await collectPreviewsInto(paths, loaded);
    for (const path of paths) {
      rereadDuringRefresh?.add(path);
    }
    mergePreviews(loaded, { prune });
  };

  /**
   * Point the store at a working folder. Nothing held belongs to a different
   * one, so everything is dropped; then that folder's snapshot, if it has
   * one, fills the lists before a single note has been read.
   */
  const holdProfile = async (profileId: string | null): Promise<void> => {
    if (profileId === heldProfileId) {
      return;
    }
    heldProfileId = profileId;
    snapshotStale = false;
    // Tree reads started for the previous folder must not land.
    treeReadShown = treeReadsStarted;
    set({ tree: null, previews: new Map(), previewVersions: new Map() });
    if (profileId === null) {
      return;
    }
    if (!snapshotsAllowed()) {
      await deletePreviewSnapshot(profileId);
      return;
    }
    const raw = await readPreviewSnapshot(profileId);
    if (!raw || heldProfileId !== profileId) {
      return;
    }
    mergePreviews(new Map<string, LoadedPreview>(parsePreviewSnapshot(raw)));
    // What was just restored is exactly what is on disk.
    snapshotStale = false;
  };

  const saveSnapshot = async (profileId: string | null): Promise<void> => {
    if (profileId === null || profileId !== heldProfileId) {
      return;
    }
    if (!snapshotsAllowed()) {
      await deletePreviewSnapshot(profileId);
      return;
    }
    if (!snapshotStale) {
      return;
    }
    snapshotStale = false;
    const { previews, previewVersions } = get();
    const notes = new Map<string, VersionedPreview>();
    for (const [path, preview] of previews) {
      const version = previewVersions.get(path);
      if (version) {
        notes.set(path, { version, preview });
      }
    }
    await writePreviewSnapshot(profileId, serializePreviewSnapshot(notes));
  };

  /**
   * Reload the tree after a mutation and fetch previews only for paths that
   * are genuinely new — the notes that moved keep their content, only their
   * key changes. Previews for paths that no longer exist are dropped.
   *
   * Diffing against the tree rather than assuming `destination/basename`
   * survives the core renaming a file to avoid a collision.
   */
  const settleAfterMutation = async (): Promise<void> => {
    const before = new Set(collectNotePaths(get().tree));
    const tree = await reloadTree();
    const known = get().previews;
    await rereadPreviews(
      collectNotePaths(tree).filter(
        (path) =>
          !before.has(path) ||
          // Missing previews are the running refresh's job, not this move's.
          (!known.has(path) && !refreshInFlight)
      ),
      true
    );
  };

  /** Mutations report failure by throwing; the UI decides what to say. */
  const mutate = async (
    reason: string,
    run: () => Promise<void>
  ): Promise<void> => {
    try {
      await run();
    } catch (error) {
      set({ error: getErrorMessage(error) });
      throw error;
    }
    useSyncStore.getState().scheduleAutoSync(reason);
  };

  const fullRefresh = async (): Promise<void> => {
    set({ loading: true });
    const reread = new Set<string>();
    rereadDuringRefresh = reread;
    const profileId = activeProfileId();
    try {
      await holdProfile(profileId);
      const tree = await reloadTree();
      const known = get().previewVersions;
      // Only notes whose file changed since their preview was read: after the
      // first launch, whatever a sync or this phone itself changed.
      const stale = collectNoteEntries(tree)
        .filter((note) => !note.version || known.get(note.path) !== note.version)
        .map((note) => note.path);
      const streamPrefix = `${STREAM_FOLDER_PATH}/`;
      // The tree lists the Feed newest-first.
      const feed = stale.filter((path) => path.startsWith(streamPrefix));
      // Published in steps, not per batch: every publish rebuilds the lists,
      // which sorts and date-groups the whole Feed. The top of the Feed comes
      // first — it is what the menu opens on.
      for (const group of [
        feed.slice(0, PREVIEW_BATCH),
        feed.slice(PREVIEW_BATCH),
        stale.filter((path) => !path.startsWith(streamPrefix)),
      ]) {
        if (group.length === 0) {
          continue;
        }
        const loaded = new Map<string, LoadedPreview>();
        await collectPreviewsInto(group, loaded);
        mergePreviews(loaded, { skip: reread });
      }
      // Notes filed, moved, deleted or rewritten meanwhile: settle against
      // the tree as it is now, reading only what is missing or changed.
      const latest = await reloadTree();
      const { previews, previewVersions } = get();
      const loaded = new Map<string, LoadedPreview>();
      await collectPreviewsInto(
        collectNoteEntries(latest)
          .filter(
            (note) =>
              !previews.has(note.path) ||
              (note.version && previewVersions.get(note.path) !== note.version)
          )
          .map((note) => note.path),
        loaded
      );
      mergePreviews(loaded, { skip: reread, prune: true });
      set({ loading: false });
      await saveSnapshot(profileId);
    } catch (error) {
      set({ loading: false, error: getErrorMessage(error) });
    } finally {
      if (rereadDuringRefresh === reread) {
        rereadDuringRefresh = null;
      }
    }
  };

  return {
  tree: null,
  previews: new Map(),
  previewVersions: new Map(),
  loading: false,
  error: null,

  refresh: () => {
    if (refreshInFlight) {
      refreshAgain = true;
      return refreshInFlight;
    }
    refreshInFlight = (async () => {
      try {
        do {
          refreshAgain = false;
          await fullRefresh();
        } while (refreshAgain);
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  },

  refreshPreviews: async (paths) => {
    if (paths.length === 0) {
      return;
    }
    try {
      await rereadPreviews(paths);
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  noteFiled: async (path) => {
    try {
      // get_tree never reads note bodies, so this stays cheap no matter how
      // many notes the folder holds.
      await reloadTree();
    } catch (error) {
      set({ error: getErrorMessage(error) });
      return;
    }
    await get().refreshPreviews([path]);
  },

  moveNotes: async (paths, destination) => {
    if (paths.length === 0) {
      return;
    }
    await mutate("notes moved", async () => {
      // The core create_dir_all's the destination, so this is also how a new
      // folder comes into existence — there is no create-folder command.
      await core.moveItems(paths, destination);
      await settleAfterMutation();
    });
  },

  deleteNotes: async (paths) => {
    if (paths.length === 0) {
      return;
    }
    await mutate("notes deleted", async () => {
      await core.deleteItems(paths);
      await settleAfterMutation();
    });
  },

  setArchived: async (path, archived) => {
    await mutate(archived ? "note archived" : "note unarchived", async () => {
      await core.updateNoteMarkers({ path, archived });
      // The body is unchanged; only the marker in its front matter moved.
      await get().refreshPreviews([path]);
    });
  },
  };
});
