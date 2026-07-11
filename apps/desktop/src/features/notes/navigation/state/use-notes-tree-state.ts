// Read side of the notes navigation slice.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppearance } from "@/app/state/appearance-store";
import {
  selectActiveProfileId,
  selectActiveProfileNotesRoot,
  useProfilesStore,
} from "@/features/profiles/state/profiles-store";
import {
  selectIsSecurityEnabled,
  useSecurityStore,
} from "@/features/security/state/security-store";
import * as api from "@/features/notes/api/notes-api";
import { useNotePreviews } from "@/features/notes/list/hooks/use-note-previews";
import type { FolderNode, NoteEntry, VisibleNavigationItem } from "@typenotes/shared/types";
import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import { collectAllNotes, getNoteParentPath } from "@typenotes/shared/notes";
import { buildTreeItems, findNode, flattenTree } from "@/features/notes/navigation/model/tree-ops";
import { removeChildrenOf } from "@/features/notes/navigation/model/dnd-tree";
import type { NotePreview } from "@typenotes/shared/format";
import type { TreeItem } from "@/features/notes/navigation/model/types";
import type { FlattenedItem } from "@/features/notes/navigation/model/types";
import {
  buildFeedTree,
  collectFeedNotes,
  findFeedNode,
  getFirstFeedGroupId,
  type FeedTreeNode,
} from "@/features/notes/navigation/model/feed-tree-model";
import {
  buildNotePreviews,
  mapParentById,
  selectPreviewSourceNotes,
} from "@/features/notes/navigation/model/notes-tree-model";
import { buildVisibleNavigationItems } from "@/features/notes/navigation/model/visible-navigation";

type UseNotesTreeStateArgs = {
  activeFolder: string;
};

export type NotesTreeState = {
  tree: FolderNode | null;
  setTree: React.Dispatch<React.SetStateAction<FolderNode | null>>;
  treeData: TreeItem[];
  flatItems: FlattenedItem[];
  visibleItems: FlattenedItem[];
  orderedIds: string[];
  flatItemById: Map<string, FlattenedItem>;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  notes: NoteEntry[];
  allNotes: NoteEntry[];
  notePreviews: Record<string, NotePreview>;
  allNotePreviews: Record<string, NotePreview>;
  activeNode: FolderNode | null;
  visibleNavigationItems: VisibleNavigationItem[];
  feedVisibleNavigationItems: VisibleNavigationItem[];
  feedTreeData: FeedTreeNode[];
  feedNodeById: Map<string, FeedTreeNode>;
  activeFeedGroup: string;
  setActiveFeedGroup: React.Dispatch<React.SetStateAction<string>>;
  activeFeedNode: FeedTreeNode | null;
  feedNotes: Array<NoteEntry & { timestampMs: number }>;
  feedNotePreviews: Record<string, NotePreview>;
  feedLoading: boolean;
  parentById: Record<string, string | null>;
  renamingFolder: string | null;
  setRenamingFolder: React.Dispatch<React.SetStateAction<string | null>>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  refreshTree: () => Promise<void>;
  shouldNestNotesInNavigation: boolean;
};

export function useNotesTreeState({
  activeFolder,
}: UseNotesTreeStateArgs): NotesTreeState {
  const activeProfileId = useProfilesStore(selectActiveProfileId);
  const activeProfileNotesRoot = useProfilesStore(selectActiveProfileNotesRoot);
  const isSecurityEnabled = useSecurityStore(selectIsSecurityEnabled);
  const notesListMode = useAppearance((state) => state.notesListMode);
  const hideArchivedFeedNotes = useAppearance((state) => state.hideArchivedFeedNotes);

  const [tree, setTree] = useState<FolderNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [activeFeedGroup, setActiveFeedGroup] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const shouldNestNotesInNavigation = notesListMode === "nested";

  const refreshTree = useCallback(async () => {
    const data = await api.getTree();
    setTree(data);
  }, []);

  const treeData = useMemo(() => {
    if (!tree) return [] as TreeItem[];
    return buildTreeItems(tree);
  }, [tree]);

  const flatItems = useMemo(() => flattenTree(treeData), [treeData]);

  const visibleItems = useMemo(() => {
    const collapsedIds = flatItems
      .filter((item) => item.children.length > 0 && !expanded.has(item.id))
      .map((item) => item.id);
    return removeChildrenOf(flatItems, collapsedIds);
  }, [flatItems, expanded]);

  const orderedIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems]);
  const flatItemById = useMemo(
    () => new Map(flatItems.map((item) => [item.id, item] as const)),
    [flatItems]
  );

  const activeNode = useMemo(() => findNode(tree, activeFolder), [tree, activeFolder]);
  const notes = useMemo(() => activeNode?.notes || [], [activeNode]);
  const allNotes = useMemo(() => collectAllNotes(tree), [tree]);
  const feedSourceNotes = useMemo(
    () => allNotes.filter((note) => getNoteParentPath(note.path) === FEED_FOLDER_PATH),
    [allNotes]
  );
  const previewSourceNotes = useMemo<NoteEntry[]>(
    () =>
      selectPreviewSourceNotes({
        activeFolder,
        notes,
        feedNotes: feedSourceNotes,
        allNotes,
        shouldNestNotesInNavigation,
      }),
    [
      activeFolder,
      notes,
      feedSourceNotes,
      allNotes,
      shouldNestNotesInNavigation,
    ]
  );
  const allNotePaths = useMemo(() => allNotes.map((note) => note.path), [allNotes]);
  const {
    previews: allNotePreviews,
    isLoading: notePreviewsLoading,
  } = useNotePreviews(previewSourceNotes, {
    resetKey: activeProfileId
      ? `${activeProfileId}:${activeProfileNotesRoot ?? ""}`
      : null,
    // Plaintext preview snapshots must never persist for encrypted vaults.
    persistKey: !isSecurityEnabled && activeProfileId ? activeProfileId : null,
    allNotePaths,
  });
  const notePreviews = useMemo(
    () => buildNotePreviews(notes, allNotePreviews),
    [allNotePreviews, notes]
  );
  const feedTree = useMemo(
    () => buildFeedTree(feedSourceNotes, allNotePreviews, hideArchivedFeedNotes),
    [allNotePreviews, feedSourceNotes, hideArchivedFeedNotes]
  );
  const feedTreeData = feedTree.treeData;
  const feedNodeById = feedTree.nodeById;
  const feedVisibleNavigationItems = useMemo(
    () => buildVisibleNavigationItems(feedTreeData, expanded, shouldNestNotesInNavigation),
    [expanded, feedTreeData, shouldNestNotesInNavigation]
  );

  useEffect(() => {
    if (feedTreeData.length === 0) {
      if (activeFeedGroup) {
        setActiveFeedGroup("");
      }
      return;
    }
    if (!activeFeedGroup || !feedNodeById.has(activeFeedGroup)) {
      setActiveFeedGroup(getFirstFeedGroupId(feedTreeData));
    }
  }, [activeFeedGroup, feedNodeById, feedTreeData]);

  const activeFeedNode = useMemo(
    () => findFeedNode(feedTreeData, activeFeedGroup),
    [activeFeedGroup, feedTreeData]
  );
  const feedNotes = useMemo(() => collectFeedNotes(activeFeedNode), [activeFeedNode]);
  const feedNotePreviews = useMemo(
    () => buildNotePreviews(feedNotes, allNotePreviews),
    [allNotePreviews, feedNotes]
  );
  const feedLoading = feedSourceNotes.length > 0 && notePreviewsLoading;

  const parentById = useMemo(() => mapParentById(flatItems), [flatItems]);

  const visibleNavigationItems = useMemo(
    () => buildVisibleNavigationItems(treeData, expanded, shouldNestNotesInNavigation),
    [expanded, shouldNestNotesInNavigation, treeData]
  );

  // Tree state is profile-scoped. Any profile/root switch should throw away the
  // cached tree and rebuild it from the active root instead of trying to diff.
  useEffect(() => {
    if (!activeProfileId) {
      return;
    }
    setTree(null);
    void refreshTree();
  }, [activeProfileId, activeProfileNotesRoot, refreshTree]);

  useEffect(() => {
    const onTreeInvalidated = () => {
      void refreshTree();
    };
    window.addEventListener("notes-tree-invalidated", onTreeInvalidated);
    return () => window.removeEventListener("notes-tree-invalidated", onTreeInvalidated);
  }, [refreshTree]);

  return {
    tree,
    setTree,
    treeData,
    flatItems,
    visibleItems,
    orderedIds,
    flatItemById,
    expanded,
    setExpanded,
    notes,
    allNotes,
    notePreviews,
    allNotePreviews,
    activeNode,
    visibleNavigationItems,
    feedVisibleNavigationItems,
    feedTreeData,
    feedNodeById,
    activeFeedGroup,
    setActiveFeedGroup,
    activeFeedNode,
    feedNotes,
    feedNotePreviews,
    feedLoading,
    parentById,
    renamingFolder,
    setRenamingFolder,
    renameValue,
    setRenameValue,
    refreshTree,
    shouldNestNotesInNavigation,
  };
}
