// Notes navigation store: the folder tree, expansion, feed grouping, and the
// preview map. Raw state lives in zustand; every derived shape (flattened
// tree, feed buckets, visible rows, …) is a module-memoized pure function, so
// React selectors and plain actions share one cached computation per input.
import { create } from "zustand";

import { useAppearance } from "./appearance-store";
import { useSelection } from "./selection-store";
import * as api from "@/api/notes-api";
import { memoizeOne } from "@/lib/memoize";
import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import type { NotePreview } from "@typenotes/shared/format";
import { collectAllNotes, getNoteParentPath } from "@typenotes/shared/notes";
import type {
  FolderNode,
  NoteEntry,
  VisibleNavigationItem,
} from "@typenotes/shared/types";
import { removeChildrenOf } from "@/lib/notes/dnd-tree";
import {
  buildFeedTree,
  collectFeedNotes,
  findFeedNode,
  getFirstFeedGroupId,
  type FeedTreeBuildResult,
  type FeedTreeNode,
} from "@/lib/notes/feed-tree-model";
import {
  buildNotePreviews,
  mapParentById,
  selectPreviewSourceNotes,
} from "@/lib/notes/notes-tree-model";
import { buildTreeItems, findNode, flattenTree } from "@/lib/notes/tree-ops";
import type { FlattenedItem, TreeItem } from "@/lib/notes/types";
import { buildVisibleNavigationItems } from "@/lib/notes/visible-navigation";

type SetValue<T> = T | ((current: T) => T);
const resolveValue = <T,>(value: SetValue<T>, current: T): T =>
  typeof value === "function" ? (value as (current: T) => T)(current) : value;

type NotesState = {
  tree: FolderNode | null;
  expanded: Set<string>;
  /** Feed bucket the user picked; may go stale — read via useActiveFeedGroup. */
  activeFeedGroup: string;
  renamingFolder: string | null;
  renameValue: string;
  /** Latest parsed previews for the current preview-source note set. */
  previews: Record<string, NotePreview>;
  previewsLoading: boolean;
};

export const useNotesStore = create<NotesState>(() => ({
  tree: null,
  expanded: new Set([""]),
  activeFeedGroup: "",
  renamingFolder: null,
  renameValue: "",
  previews: {},
  previewsLoading: false,
}));

// ---- plain setters ----

export const setTree = (value: SetValue<FolderNode | null>) =>
  useNotesStore.setState((state) => ({ tree: resolveValue(value, state.tree) }));
export const setExpanded = (value: SetValue<Set<string>>) =>
  useNotesStore.setState((state) => ({
    expanded: resolveValue(value, state.expanded),
  }));
export const setActiveFeedGroup = (value: SetValue<string>) =>
  useNotesStore.setState((state) => ({
    activeFeedGroup: resolveValue(value, state.activeFeedGroup),
  }));
export const setRenameValue = (renameValue: string) =>
  useNotesStore.setState({ renameValue });

export async function refreshTree() {
  const tree = await api.getTree();
  useNotesStore.setState({ tree });
}

// ---- derived state (memoized per input identity, shared by all consumers) ----

const EMPTY_TREE_DATA: TreeItem[] = [];
const EMPTY_NOTES: NoteEntry[] = [];

const getTreeData = memoizeOne((tree: FolderNode | null): TreeItem[] =>
  tree ? buildTreeItems(tree) : EMPTY_TREE_DATA
);
const getFlatItems = memoizeOne((treeData: TreeItem[]) => flattenTree(treeData));
const getVisibleItems = memoizeOne(
  (flatItems: FlattenedItem[], expanded: Set<string>) => {
    const collapsedIds = flatItems
      .filter((item) => item.children.length > 0 && !expanded.has(item.id))
      .map((item) => item.id);
    return removeChildrenOf(flatItems, collapsedIds);
  }
);
const getOrderedIds = memoizeOne((visibleItems: FlattenedItem[]) =>
  visibleItems.map((item) => item.id)
);
const getFlatItemById = memoizeOne(
  (flatItems: FlattenedItem[]) =>
    new Map(flatItems.map((item) => [item.id, item] as const))
);
const getParentById = memoizeOne(mapParentById);
const getAllNotes = memoizeOne(collectAllNotes);
const getFeedSourceNotes = memoizeOne((allNotes: NoteEntry[]) =>
  allNotes.filter((note) => getNoteParentPath(note.path) === FEED_FOLDER_PATH)
);
const getActiveNode = memoizeOne(
  (tree: FolderNode | null, activeFolder: string) => findNode(tree, activeFolder)
);
const getActiveFolderNotes = memoizeOne(
  (activeNode: FolderNode | null): NoteEntry[] => activeNode?.notes || EMPTY_NOTES
);
const getPreviewSourceNotes = memoizeOne(
  (
    activeFolder: string,
    notes: NoteEntry[],
    feedNotes: NoteEntry[],
    allNotes: NoteEntry[],
    shouldNestNotesInNavigation: boolean
  ) =>
    selectPreviewSourceNotes({
      activeFolder,
      notes,
      feedNotes,
      allNotes,
      shouldNestNotesInNavigation,
    })
);
const getActiveNotePreviews = memoizeOne(buildNotePreviews);
const getFeedTree = memoizeOne(buildFeedTree);
const getEffectiveFeedGroup = memoizeOne(
  (feedTree: FeedTreeBuildResult, storedGroup: string) => {
    if (feedTree.treeData.length === 0) {
      return "";
    }
    if (storedGroup && feedTree.nodeById.has(storedGroup)) {
      return storedGroup;
    }
    return getFirstFeedGroupId(feedTree.treeData);
  }
);
const getActiveFeedNode = memoizeOne(
  (feedTreeData: FeedTreeNode[], effectiveGroup: string) =>
    findFeedNode(feedTreeData, effectiveGroup)
);
const getFeedNotes = memoizeOne(collectFeedNotes);
const getFeedNotePreviews = memoizeOne(buildNotePreviews);
const getVisibleNavigationItems = memoizeOne(buildVisibleNavigationItems);
const getFeedVisibleNavigationItems = memoizeOne(
  (feedTreeData: FeedTreeNode[], expanded: Set<string>, includeNotes: boolean) =>
    buildVisibleNavigationItems(feedTreeData, expanded, includeNotes)
);

// Single-store derivations, usable as zustand selectors and on getState().
export const selectTreeData = (state: NotesState) => getTreeData(state.tree);
export const selectFlatItems = (state: NotesState) =>
  getFlatItems(selectTreeData(state));
export const selectVisibleItems = (state: NotesState) =>
  getVisibleItems(selectFlatItems(state), state.expanded);
export const selectOrderedIds = (state: NotesState) =>
  getOrderedIds(selectVisibleItems(state));
export const selectFlatItemById = (state: NotesState) =>
  getFlatItemById(selectFlatItems(state));
export const selectParentById = (state: NotesState) =>
  getParentById(selectFlatItems(state));
export const selectAllNotes = (state: NotesState) => getAllNotes(state.tree);
export const selectFeedSourceNotes = (state: NotesState) =>
  getFeedSourceNotes(selectAllNotes(state));

// ---- cross-store derivations (hooks + plain accessors) ----

export const useShouldNestNotesInNavigation = () =>
  useAppearance((state) => state.notesListMode === "nested");

export function useActiveNode(): FolderNode | null {
  const tree = useNotesStore((state) => state.tree);
  const activeFolder = useSelection((state) => state.activeFolder);
  return getActiveNode(tree, activeFolder);
}

/** Notes of the active folder (empty while nothing is selected). */
export function useActiveFolderNotes(): NoteEntry[] {
  return getActiveFolderNotes(useActiveNode());
}

/** Previews scoped to the active folder's notes. */
export function useActiveNotePreviews(): Record<string, NotePreview> {
  const previews = useNotesStore((state) => state.previews);
  return getActiveNotePreviews(useActiveFolderNotes(), previews);
}

export function useFeedTree(): FeedTreeBuildResult {
  const feedSourceNotes = useNotesStore(selectFeedSourceNotes);
  const previews = useNotesStore((state) => state.previews);
  const hideArchived = useAppearance((state) => state.hideArchivedFeedNotes);
  return getFeedTree(feedSourceNotes, previews, hideArchived);
}

/** The stored feed group, corrected to the first bucket when stale/empty. */
export function useActiveFeedGroup(): string {
  const feedTree = useFeedTree();
  const storedGroup = useNotesStore((state) => state.activeFeedGroup);
  return getEffectiveFeedGroup(feedTree, storedGroup);
}

export function useActiveFeedNode(): FeedTreeNode | null {
  const feedTree = useFeedTree();
  const storedGroup = useNotesStore((state) => state.activeFeedGroup);
  return getActiveFeedNode(
    feedTree.treeData,
    getEffectiveFeedGroup(feedTree, storedGroup)
  );
}

export function useFeedNotes(): Array<NoteEntry & { timestampMs: number }> {
  return getFeedNotes(useActiveFeedNode());
}

export function useFeedNotePreviews(): Record<string, NotePreview> {
  const previews = useNotesStore((state) => state.previews);
  return getFeedNotePreviews(useFeedNotes(), previews);
}

export function useFeedLoading(): boolean {
  const hasFeedNotes = useNotesStore(
    (state) => selectFeedSourceNotes(state).length > 0
  );
  const loading = useNotesStore((state) => state.previewsLoading);
  return hasFeedNotes && loading;
}

export function useVisibleNavigationItems(): VisibleNavigationItem[] {
  const treeData = useNotesStore(selectTreeData);
  const expanded = useNotesStore((state) => state.expanded);
  return getVisibleNavigationItems(
    treeData,
    expanded,
    useShouldNestNotesInNavigation()
  );
}

export function useFeedVisibleNavigationItems(): VisibleNavigationItem[] {
  const feedTree = useFeedTree();
  const expanded = useNotesStore((state) => state.expanded);
  return getFeedVisibleNavigationItems(
    feedTree.treeData,
    expanded,
    useShouldNestNotesInNavigation()
  );
}

/** Current preview-source note set, for the preview loader (non-React). */
export function computePreviewSourceNotes(): NoteEntry[] {
  const state = useNotesStore.getState();
  const activeFolder = useSelection.getState().activeFolder;
  const shouldNest = useAppearance.getState().notesListMode === "nested";
  return getPreviewSourceNotes(
    activeFolder,
    getActiveFolderNotes(getActiveNode(state.tree, activeFolder)),
    selectFeedSourceNotes(state),
    selectAllNotes(state),
    shouldNest
  );
}

/** Feed node the capture/editor flows should target, for non-React callers. */
export function computeActiveFeedNode(): FeedTreeNode | null {
  const state = useNotesStore.getState();
  const feedTree = getFeedTree(
    selectFeedSourceNotes(state),
    state.previews,
    useAppearance.getState().hideArchivedFeedNotes
  );
  return getActiveFeedNode(
    feedTree.treeData,
    getEffectiveFeedGroup(feedTree, state.activeFeedGroup)
  );
}
