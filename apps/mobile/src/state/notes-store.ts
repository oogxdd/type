import { create } from "zustand";

import * as core from "@typenotes/mobile-core/core-api";
import { STREAM_FOLDER_PATH } from "@typenotes/shared/constants";
import { getErrorMessage } from "@typenotes/shared/errors";
import type { NotePreview } from "@typenotes/shared/format";
import type { FolderNode, GitSyncCycleResult } from "@typenotes/shared/types";

import { applySyncTreePatch, visibleSyncPath } from "../lib/sync-note-tree";
import { collectNoteEntries, collectNotePaths } from "../lib/feed";
import { runNoteJob } from "../lib/note-worker";
import { prioritizeNotes, reconcileNoteTree, yieldForNoteHistory } from "../lib/note-loading";
import type { PreviewChange } from "../lib/note-processing";
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
import { mobileRuntime } from "../core/runtime";

/**
 * Rust returns bounded list text, never full bodies. JSON is decoded by the
 * native Worker Runtime before small results are published to React.
 */
const PREVIEW_BATCH = 200;

/** A freshly read preview and the file version it was read at. */
type LoadedPreview = { preview: NotePreview; version: string | null };

const collectPreviewsInto = async (
  paths: string[],
  into: Map<string, LoadedPreview>
): Promise<void> => {
  for (let index = 0; index < paths.length; index += PREVIEW_BATCH) {
    if (index > 0) await yieldForNoteHistory();
    const raw = await core.listNoteSummariesRaw(paths.slice(index, index + PREVIEW_BATCH));
    const result = await runNoteJob({ kind: "summaries", raw });
    for (const [path, value] of result.changes ?? []) into.set(path, value);
  }
};

/** The working folder whose notes should be showing; null before settings load. */
const activeProfileId = (): string | null =>
  activeProfile(useSettingsStore.getState().snapshot)?.id ?? null;
const workspaceKey = (): string => {
  const profile = activeProfile(useSettingsStore.getState().snapshot);
  return JSON.stringify([profile?.id ?? null, profile?.notes_root ?? null]);
};

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
  /** Only the affected folder gets a new map; unrelated lists keep their inputs. */
  folderPreviews: Map<string, Map<string, NotePreview>>;
  notePaths: Set<string>;
  folderRevisions: Map<string, number>;
  processingScope: string;
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
  applySyncChanges: (result: GitSyncCycleResult) => Promise<void>;
  /** Refresh previews for a few paths without re-reading the whole tree. */
  refreshPreviews: (paths: string[]) => Promise<void>;
  /**
   * Publish a saved page. Known paths refresh only their compact summary;
   * a new path also reloads the body-free tree so its row can appear.
   * Failure throws so the editor can retry publication without rewriting it.
   */
  noteFiled: (path: string) => Promise<void>;
  noteRemoved: (path: string) => Promise<void>;

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
let epoch = 0;
const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
const readable = () => !useSecurityStore.getState().state?.locked;
const current = (generation: number, profile: string | null) => epoch === generation && activeProfileId() === profile && readable();
const workerScope = () => `${heldProfileId ?? "demo"}:${epoch}`;
const samePreview = (a: NotePreview | undefined, b: NotePreview) => a !== undefined &&
  Object.keys(b).every((key) => {
    const field = key as keyof NotePreview;
    return field === "tags" ? JSON.stringify(a.tags ?? []) === JSON.stringify(b.tags ?? []) : a[field] === b[field];
  });

export const useNotesStore = create<NotesState>((set, get) => {
  let watchersInstalled = false;
  let mutationRevision = 0;
  const pathReads = new Map<string, number>();
  let syncChanges: Promise<void> = Promise.resolve();
  const clearWorkspace = () => {
    epoch += 1;
    pathReads.clear();
    mutationRevision += 1;
    heldProfileId = activeProfileId();
    snapshotStale = false;
    treeReadShown = treeReadsStarted;
    const scope = workerScope();
    set({ tree: null, notePaths: new Set(), previews: new Map(), folderPreviews: new Map(), folderRevisions: new Map(), previewVersions: new Map(), processingScope: scope, loading: false });
    void runNoteJob({ kind: "reset", scope, workspace: workspaceKey() }).catch(() => {});
  };
  const watchContext = () => {
    if (watchersInstalled) return;
    watchersInstalled = true;
    useSettingsStore.subscribe((state, previous) => {
      const profile = activeProfile(state.snapshot);
      const before = activeProfile(previous.snapshot);
      if (profile?.id !== before?.id || profile?.notes_root !== before?.notes_root) clearWorkspace();
    });
    useSecurityStore.subscribe((state, previous) => {
      if (state.state?.locked && !previous.state?.locked) clearWorkspace();
      if (state.state?.encryption_enabled && !previous.state?.encryption_enabled) {
        const profile = activeProfileId();
        if (profile) void deletePreviewSnapshot(profile);
      }
    });
  };
  const updateWorker = async (changes: PreviewChange[], removed: string[] = []) => {
    await runNoteJob({ kind: "update", scope: workerScope(), changes, removed });
  };
  /** Read the tree and show it, unless a read that started later already landed. */
  const reloadTree = async (): Promise<FolderNode | null> => {
    const read = ++treeReadsStarted;
    const generation = epoch;
    const profile = activeProfileId();
    const raw = await core.getTreeRaw();
    const tree = (await runNoteJob({ kind: "tree", raw })).tree!;
    if (read > treeReadShown && current(generation, profile)) {
      treeReadShown = read;
      const reconciled = reconcileNoteTree(get().tree, tree);
      if (reconciled !== get().tree) set({ tree: reconciled, notePaths: new Set(collectNotePaths(reconciled)), error: null });
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
  ): PreviewChange[] => {
    let changed = false;
    const accepted: PreviewChange[] = [];
    const removed: string[] = [];
    set((state) => {
      // Normalized indexes are internal mutable maps. Folder revision counters
      // notify React without copying thousands of unrelated entries per batch.
      const previews = state.previews;
      const previewVersions = state.previewVersions;
      const folderPreviews = state.folderPreviews;
      const folderRevisions = new Map(state.folderRevisions);
      const touched = new Set<string>();
      const folderMap = (path: string) => {
        const folder = folderOf(path);
        if (!touched.has(folder)) {
          if (!folderPreviews.has(folder)) folderPreviews.set(folder, new Map());
          folderRevisions.set(folder, (folderRevisions.get(folder) ?? 0) + 1);
          touched.add(folder);
        }
        return folderPreviews.get(folder)!;
      };
      for (const [path, { preview, version }] of loaded) {
        if (skip?.has(path)) {
          continue;
        }
        if (state.previewVersions.get(path) === version && samePreview(state.previews.get(path), preview)) continue;
        accepted.push([path, { preview, version }]);
        if (!samePreview(state.previews.get(path), preview)) {
          previews.set(path, preview);
          folderMap(path).set(path, preview);
        }
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
            folderMap(path).delete(path);
            removed.push(path);
            changed = true;
          }
        }
      }
      return changed ? {
        previews: touched.size ? previews : state.previews,
        folderPreviews: touched.size ? folderPreviews : state.folderPreviews,
        previewVersions,
        folderRevisions,
      } : state;
    });
    if (changed) {
      snapshotStale = true;
      void updateWorker(accepted, removed).catch(() => { snapshotStale = true; });
    }
    return accepted;
  };

  /** Read these previews on their own; a running full refresh will not overwrite them. */
  const rereadPreviews = async (paths: string[], prune = false): Promise<void> => {
    const loaded = new Map<string, LoadedPreview>();
    const generation = epoch;
    const profile = activeProfileId();
    const revisions = new Map(paths.map((path) => {
      const revision = (pathReads.get(path) ?? 0) + 1;
      pathReads.set(path, revision);
      return [path, revision];
    }));
    await collectPreviewsInto(paths, loaded);
    if (!current(generation, profile)) return;
    for (const path of loaded.keys()) if (pathReads.get(path) !== revisions.get(path)) loaded.delete(path);
    for (const path of loaded.keys()) rereadDuringRefresh?.add(path);
    mergePreviews(loaded, { prune });
  };

  /**
   * Point the store at a working folder. Nothing held belongs to a different
   * one, so everything is dropped; then that folder's snapshot, if it has
   * one, fills the lists before a single note has been read.
   */
  const holdProfile = async (profileId: string | null): Promise<void> => {
    watchContext();
    if (profileId === heldProfileId && get().processingScope === workerScope() && (get().tree || get().previews.size)) {
      return;
    }
    heldProfileId = profileId;
    epoch += 1;
    const generation = epoch;
    const scope = workerScope();
    await runNoteJob({ kind: "reset", scope, workspace: workspaceKey() });
    if (!current(generation, profileId)) return;
    snapshotStale = false;
    // Tree reads started for the previous folder must not land.
    treeReadShown = treeReadsStarted;
    set({ tree: null, previews: new Map(), folderPreviews: new Map(), folderRevisions: new Map(), previewVersions: new Map(), notePaths: new Set(), processingScope: scope });
    if (profileId === null) {
      return;
    }
    if (!snapshotsAllowed()) {
      await deletePreviewSnapshot(profileId);
      return;
    }
    const raw = await readPreviewSnapshot(profileId);
    if (!raw || !current(generation, profileId) || !snapshotsAllowed()) {
      return;
    }
    const restored = await runNoteJob({ kind: "restore", scope, raw });
    if (!current(generation, profileId) || !snapshotsAllowed()) return;
    mergePreviews(new Map(restored.changes));
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
    const generation = epoch;
    snapshotStale = false;
    const result = await runNoteJob({ kind: "snapshot", scope: workerScope() });
    if (!current(generation, profileId) || !snapshotsAllowed()) return;
    const written = await writePreviewSnapshot(profileId, result.raw!);
    if (!written && current(generation, profileId)) snapshotStale = true;
    if (!snapshotsAllowed()) await deletePreviewSnapshot(profileId);
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
    const token = mobileRuntime.workspace();
    mutationRevision += 1;
    try {
      await mobileRuntime.track(run, token);
    } catch (error) {
      if (mobileRuntime.isCurrent(token)) set({ error: getErrorMessage(error) });
      throw error;
    }
    if (mobileRuntime.isCurrent(token)) mobileRuntime.onSaved(reason);
  };

  const fullRefresh = async (): Promise<void> => {
    set({ loading: true });
    const reread = new Set<string>();
    rereadDuringRefresh = reread;
    const profileId = activeProfileId();
    let generation = epoch;
    try {
      await holdProfile(profileId);
      generation = epoch;
      if (!current(generation, profileId)) return;
      const tree = await reloadTree();
      if (!current(generation, profileId)) return;
      const known = get().previewVersions;
      // Only notes whose file changed since their preview was read: after the
      // first launch, whatever a sync or this phone itself changed.
      const stale = collectNoteEntries(tree)
        .filter((note) => !note.version || known.get(note.path) !== note.version);
      const streamPrefix = `${STREAM_FOLDER_PATH}/`;
      // The tree lists the Feed newest-first.
      const feed = stale.filter((note) => note.path.startsWith(streamPrefix));
      // Publish bounded portions: the worker retains sorted history and sends
      // only changed sections. Recent local-calendar notes come first.
      const groups = [...prioritizeNotes(feed, get().previews), stale.filter((note) => !note.path.startsWith(streamPrefix)).map((note) => note.path)];
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        const group = groups[groupIndex];
        for (let index = 0; index < group.length; index += PREVIEW_BATCH) {
          if (groupIndex >= 3 || index > 0) await yieldForNoteHistory();
          if (!current(generation, profileId)) return;
          const loaded = new Map<string, LoadedPreview>();
          await collectPreviewsInto(group.slice(index, index + PREVIEW_BATCH), loaded);
          if (!current(generation, profileId)) return;
          mergePreviews(loaded, { skip: reread });
        }
      }
      // Notes filed, moved, deleted or rewritten meanwhile: settle against
      // the tree as it is now, reading only what is missing or changed.
      const latest = await reloadTree();
      if (!current(generation, profileId)) return;
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
      if (!current(generation, profileId)) return;
      mergePreviews(loaded, { skip: reread, prune: true });
      set({ loading: false });
      await saveSnapshot(profileId);
    } catch (error) {
      if (current(generation, profileId)) set({ loading: false, error: getErrorMessage(error) });
    } finally {
      if (rereadDuringRefresh === reread) {
        rereadDuringRefresh = null;
      }
    }
  };

  return {
    tree: null,
    previews: new Map(),
    folderPreviews: new Map(),
    folderRevisions: new Map(),
    notePaths: new Set(),
    processingScope: "demo:0",
    previewVersions: new Map(),
    loading: false,
    error: null,

    refresh: () => {
      if (!readable()) return Promise.resolve();
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

    applySyncChanges: (result) => {
      const token = mobileRuntime.workspace();
      const apply = async () => {
        if (!mobileRuntime.isCurrent(token) || !readable()) return;
        if (result.reset_required || !get().tree || heldProfileId !== activeProfileId()) {
          await get().refresh(); return;
        }
        const paths = result.changed_paths.filter((path) => path.endsWith(".md") && visibleSyncPath(path));
        const folders = result.tree_patch.filter((folder) => visibleSyncPath(folder.path));
        if (!paths.length && !folders.length) return;
        const generation = epoch, profile = activeProfileId(), mutation = mutationRevision;
        const revisions = new Map(paths.map((path) => {
          const revision = (pathReads.get(path) ?? 0) + 1;
          pathReads.set(path, revision);
          return [path, revision];
        }));
        const loaded = new Map<string, LoadedPreview>();
        await collectPreviewsInto(paths, loaded);
        if (!mobileRuntime.isCurrent(token) || !current(generation, profile)) return;
        // Structural local work raced this snapshot. Reconcile from disk once
        // instead of resurrecting a locally moved/deleted row or folder.
        if (mutation !== mutationRevision) { await get().refresh(); return; }
        const accepted = (path: string) => revisions.get(path) === pathReads.get(path);
        for (const path of loaded.keys()) if (!accepted(path)) loaded.delete(path);
        const entries = result.entries.filter((entry) => accepted(entry.path) && visibleSyncPath(entry.path))
          .map((entry) => ({ ...entry, version: loaded.get(entry.path)?.version ?? entry.version }));
        // A formerly removed file may have been recreated before its compact read.
        for (const path of result.removed_paths) if (loaded.has(path)) entries.push({ path, name: path.split("/").at(-1)!, version: loaded.get(path)!.version });
        const removed = result.removed_paths.filter((path) => accepted(path) && !loaded.has(path));
        for (const path of paths) rereadDuringRefresh?.add(path);
        const tree = applySyncTreePatch(get().tree!, entries, removed, folders);
        treeReadShown = ++treeReadsStarted; // Older in-flight tree snapshots cannot land.
        if (tree !== get().tree) set({ tree, notePaths: new Set(collectNotePaths(tree)) });
        mergePreviews(loaded, { prune: true });
        snapshotStale = true;
        // Persisting the cache is separate from sending or applying this delta.
        void saveSnapshot(profile).catch(() => { snapshotStale = true; });
      };
      const pending = syncChanges.then(apply);
      syncChanges = pending.catch(() => {});
      return pending.catch(async (error) => {
        if (mobileRuntime.isCurrent(token) && readable()) {
          set({ error: getErrorMessage(error) });
          await get().refresh();
        }
        throw error;
      });
    },

    refreshPreviews: async (paths) => {
      if (paths.length === 0) {
        return;
      }
      try {
        if (!readable()) return;
        if (heldProfileId !== activeProfileId() || get().processingScope !== workerScope()) await holdProfile(activeProfileId());
        await rereadPreviews(paths);
      } catch (error) {
        set({ error: getErrorMessage(error) });
      }
    },

    noteFiled: async (path) => {
      if (!get().notePaths.has(path)) mutationRevision += 1;
      try {
        if (!readable()) return;
        if (heldProfileId !== activeProfileId() || get().processingScope !== workerScope()) await holdProfile(activeProfileId());
        if (!get().notePaths.has(path)) await reloadTree();
        await rereadPreviews([path]);
      } catch (error) {
        set({ error: getErrorMessage(error) });
        throw error;
      }
    },

    noteRemoved: async () => {
      mutationRevision += 1;
      await reloadTree();
      mergePreviews(new Map(), { prune: true });
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
