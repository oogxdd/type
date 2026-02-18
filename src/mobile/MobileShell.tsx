import {
  Archive,
  ChevronLeft,
  Clock3,
  Folder,
  Menu,
  Mic,
  Plus,
  Settings,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { SettingsSectionId } from "../components/SettingsPanel";
import type { NoteEntry } from "../types";
import {
  getCurrentRoute,
  getInitialMobileNavigationState,
  mobileNavigationReducer,
  type MobileActionSheetState,
  type MobileToastState,
} from "./navigation";
import { MobileActionSheet } from "./components/MobileActionSheet";
import { MobileEditorScreen } from "./components/MobileEditorScreen";
import { MobileFoldersScreen } from "./components/MobileFoldersScreen";
import { MobileNavBar } from "./components/MobileNavBar";
import { MobileNotesScreen } from "./components/MobileNotesScreen";
import { MobileRecentScreen } from "./components/MobileRecentScreen";
import { MobileRecordingScreen } from "./components/MobileRecordingScreen";
import { MobileSettingsScreen } from "./components/MobileSettingsScreen";
import { MobileTabBar } from "./components/MobileTabBar";
import { MobileToast } from "./components/MobileToast";
import { MobilePromptSheet } from "./components/MobilePromptSheet";

import { useTheme } from "../contexts/ThemeContext";
import { useSessions } from "../contexts/SessionsContext";
import { useRecordings } from "../contexts/RecordingsContext";
import { useNotesTree } from "../contexts/NotesTreeContext";
import { useSelection } from "../contexts/SelectionContext";
import { useEditor } from "../contexts/EditorContext";
import { useLayoutMode } from "./useLayoutMode";
import { useKeyboardInsets } from "./useKeyboardInsets";
import { MOBILE_SETTINGS_SECTIONS } from "../constants";

type MobileShellProps = {
  activeSettingsSection: SettingsSectionId;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
  onNoteContextMenu: (
    event: ReactMouseEvent,
    notePath: string,
    parentPath?: string
  ) => Promise<void>;
};

type SheetContext =
  | { type: "folder"; path: string }
  | { type: "note"; path: string };

const TABLET_LEFT_ITEMS = [
  { id: "folders", label: "Folders", icon: <Folder size={16} /> },
  { id: "settings", label: "Settings", icon: <Settings size={16} /> },
] as const;
const UNSORTED_FOLDER_PATH = "Unsorted";
const ARCHIVE_FOLDER_PATH = "Archieve";
const SYSTEM_FOLDER_PATHS = new Set(["Unsorted", "Archieve"]);
const DAY_MS = 86_400_000;

type RecentBucket = {
  id: string;
  label: string;
  subtitle: string;
  notes: NoteEntry[];
  dayEndMs: number | null;
};

const getDisplayFolderName = (rawName: string) =>
  rawName === "Archieve" ? "Archive" : rawName;
const getDisplayRouteTitle = (rawTitle: string) =>
  rawTitle === "Archieve" ? "Archive" : rawTitle;

export function MobileShell({
  activeSettingsSection,
  onSettingsSectionChange,
  onNoteContextMenu,
}: MobileShellProps) {
  // -- Contexts
  const layoutMode = useLayoutMode();
  const { keyboardInset } = useKeyboardInsets();
  const { theme, editorFontSize, notesListMode } = useTheme();
  const { syncSettings } = useSessions();
  const {
    recordingSupported,
    isRecordingAudio,
    isRecordingFinalizing,
    recorderError,
    recordingStatusMessage,
    recordingLiveStatus,
    transcriptionQueueBusy,
    startRecording,
    stopRecording,
    queueRecordingTranscriptions,
  } = useRecordings();
  const {
    visibleItems,
    expanded,
    setExpanded,
    notes,
    notePreviews,
    allNotes,
    allNotePreviews,
    activeNode,
    refreshTree,
    createNewNote,
    deleteNotes,
    deleteFolders,
    moveNotesToArchive,
    showNoteInfo,
    renameFolderFromMobile,
  } = useNotesTree();
  const {
    activeFolder,
    activeNote,
    selectFolderForMobile,
    selectNoteForMobile,
    enterMobileHome,
  } = useSelection();
  const {
    noteContent,
    draftNoteContent,
    isNoteSaving,
    noteSaveError,
    handleEditorChange,
    clearNote,
    clearDraft,
    flushSave,
    retrySave,
  } = useEditor();

  // -- Derived values (previously computed in AppShell)
  const appStyle = useMemo(
    () => ({ "--editor-font-size": `${editorFontSize}px` }) as CSSProperties,
    [editorFontSize]
  );
  const activeFolderTitle = activeNode?.name || activeFolder || "Notes";
  const activeNoteTitle =
    (activeNote ? notePreviews[activeNote]?.title : null) ||
    (activeNote ? activeNote.split("/").pop()?.replace(/\.md$/i, "") : null) ||
    "Note";
  const editorMarkdown = activeNote ? noteContent : draftNoteContent;
  const hasActiveNote = Boolean(activeNote);
  const isRecordingBusy = isRecordingFinalizing || transcriptionQueueBusy;

  // -- Local UI state
  const [navigationState, dispatch] = useReducer(
    mobileNavigationReducer,
    getInitialMobileNavigationState()
  );
  const [tabletLeftMode, setTabletLeftMode] = useState<"folders" | "settings">("folders");
  const [sheetState, setSheetState] = useState<MobileActionSheetState | null>(null);
  const [sheetContext, setSheetContext] = useState<SheetContext | null>(null);
  const [toast, setToast] = useState<MobileToastState | null>(null);
  const [foldersDrawerOpen, setFoldersDrawerOpen] = useState(false);
  const [renamePrompt, setRenamePrompt] = useState<{ path: string; currentName: string } | null>(
    null
  );
  const previousStackDepthRef = useRef(navigationState.stack.length);
  const nextTransitionRef = useRef<"forward" | "backward" | "up" | null>(null);
  const [phoneTransitionDirection, setPhoneTransitionDirection] = useState<
    "forward" | "backward" | "up"
  >("forward");

  const edgeSwipeStart = useRef<{ x: number; y: number } | null>(null);
  const edgeSwipeTriggered = useRef(false);
  const [navigationTab, setNavigationTab] = useState<"folders" | "recent">("folders");

  const currentRoute = getCurrentRoute(navigationState);

  const navigationFolders = useMemo(() => {
    const blockedIds = new Set<string>();
    return visibleItems.filter((item) => {
      const parentBlocked = item.parentId ? blockedIds.has(item.parentId) : false;
      const isHidden = item.name.startsWith(".");
      const isArchive = item.id === ARCHIVE_FOLDER_PATH;
      const shouldHide = parentBlocked || isHidden || isArchive;
      if (shouldHide) {
        blockedIds.add(item.id);
        return false;
      }
      return true;
    });
  }, [visibleItems]);

  const recentBuckets = useMemo(() => {
    if (allNotes.length > 0 && Object.keys(allNotePreviews).length === 0) {
      return [] as RecentBucket[];
    }

    const groups = new Map<
      string,
      {
        dayStart: number;
        dayEnd: number;
        notes: Array<{ note: NoteEntry; updatedMs: number }>;
      }
    >();
    const undated: NoteEntry[] = [];

    allNotes.forEach((note) => {
      const preview = allNotePreviews[note.path];
      const updatedMs = preview?.updatedMs ?? null;
      if (!updatedMs) {
        undated.push(note);
        return;
      }
      const date = new Date(updatedMs);
      if (Number.isNaN(date.getTime())) {
        undated.push(note);
        return;
      }
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const dayEnd = dayStart + DAY_MS - 1;
      const dayKey = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
      const group = groups.get(dayKey);
      if (!group) {
        groups.set(dayKey, {
          dayStart,
          dayEnd,
          notes: [{ note, updatedMs }],
        });
      } else {
        group.notes.push({ note, updatedMs });
      }
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    const buckets: RecentBucket[] = Array.from(groups.entries())
      .sort(([, left], [, right]) => right.dayStart - left.dayStart)
      .map(([id, group]) => {
        const diffDays = Math.floor((todayStartMs - group.dayStart) / DAY_MS);
        const date = new Date(group.dayStart);
        const label =
          diffDays === 0
            ? "Today"
            : diffDays === 1
              ? "Yesterday"
              : date.toLocaleDateString([], {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                });
        const subtitle = date.toLocaleDateString([], {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const sortedNotes = [...group.notes]
          .sort((left, right) => right.updatedMs - left.updatedMs)
          .map((item) => item.note);
        return {
          id,
          label,
          subtitle,
          notes: sortedNotes,
          dayEndMs: group.dayEnd,
        };
      });

    if (undated.length > 0) {
      buckets.push({
        id: "undated",
        label: "Undated",
        subtitle: "No date metadata",
        notes: undated,
        dayEndMs: null,
      });
    }
    return buckets;
  }, [allNotePreviews, allNotes]);

  const recentBucketById = useMemo(
    () => new Map(recentBuckets.map((bucket) => [bucket.id, bucket] as const)),
    [recentBuckets]
  );

  useEffect(() => {
    if (layoutMode !== "phone") {
      return;
    }
    const previousDepth = previousStackDepthRef.current;
    const nextDepth = navigationState.stack.length;
    if (nextTransitionRef.current) {
      setPhoneTransitionDirection(nextTransitionRef.current);
      nextTransitionRef.current = null;
    } else if (nextDepth > previousDepth) {
      setPhoneTransitionDirection("forward");
    } else if (nextDepth < previousDepth) {
      setPhoneTransitionDirection("backward");
    }
    previousStackDepthRef.current = nextDepth;
  }, [layoutMode, navigationState.stack.length]);

  useEffect(() => {
    if (layoutMode !== "phone") {
      return;
    }
    if (
      currentRoute.kind === "notes" ||
      currentRoute.kind === "editor" ||
      currentRoute.kind === "recording"
    ) {
      if (currentRoute.folderPath && currentRoute.folderPath !== activeFolder) {
        selectFolderForMobile(currentRoute.folderPath);
      }
    }
    if (currentRoute.kind === "editor" && currentRoute.notePath !== activeNote) {
      selectNoteForMobile(currentRoute.notePath);
    }
  }, [activeFolder, activeNote, currentRoute, layoutMode, selectFolderForMobile, selectNoteForMobile]);

  useEffect(() => {
    if (layoutMode === "tablet") {
      dispatch({ type: "reset", route: { kind: "folders" } });
      setFoldersDrawerOpen(false);
      return;
    }
    if (layoutMode === "phone") {
      dispatch({ type: "reset", route: { kind: "home" } });
      setFoldersDrawerOpen(false);
    }
  }, [layoutMode]);

  const onEnterHome = useCallback(() => {
    enterMobileHome();
    clearNote();
    clearDraft();
  }, [enterMobileHome, clearNote, clearDraft]);

  useEffect(() => {
    if (layoutMode !== "phone" || currentRoute.kind !== "home") {
      return;
    }
    onEnterHome();
  }, [currentRoute.kind, layoutMode, onEnterHome]);

  useEffect(() => {
    if (!foldersDrawerOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFoldersDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [foldersDrawerOpen]);

  const showToast = useCallback((message: string, tone: MobileToastState["tone"] = "info") => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  const closeActionSheet = useCallback(() => {
    setSheetState(null);
    setSheetContext(null);
  }, []);

  const refreshNotesFeed = useCallback(
    async (_folderPath: string) => {
      await refreshTree();
    },
    [refreshTree]
  );

  const popRoute = useCallback(async () => {
    if (layoutMode !== "phone") {
      return;
    }
    if (currentRoute.kind === "editor") {
      await flushSave();
    }
    dispatch({ type: "pop" });
  }, [currentRoute.kind, flushSave, layoutMode]);

  const openNotesRoute = useCallback(
    (folderPath: string) => {
      selectFolderForMobile(folderPath);
      dispatch({ type: "push", route: { kind: "notes", folderPath } });
      setFoldersDrawerOpen(false);
    },
    [selectFolderForMobile]
  );

  const openArchiveRoute = useCallback(() => {
    openNotesRoute(ARCHIVE_FOLDER_PATH);
  }, [openNotesRoute]);

  const openRecentBucketRoute = useCallback((bucketId: string) => {
    dispatch({ type: "push", route: { kind: "recent-date", bucketId } });
    setFoldersDrawerOpen(false);
  }, []);

  const openEditorRoute = useCallback((notePath: string, folderPath?: string) => {
    const resolvedFolderPath =
      folderPath ??
      (notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "");
    selectNoteForMobile(notePath);
    dispatch({
      type: "push",
      route: {
        kind: "editor",
        folderPath: resolvedFolderPath,
        notePath,
      },
    });
  }, [selectNoteForMobile]);

  const openRecordingRoute = useCallback(
    (folderPath: string = UNSORTED_FOLDER_PATH, autoStart?: boolean) => {
      selectFolderForMobile(folderPath);
      nextTransitionRef.current = "up";
      dispatch({ type: "push", route: { kind: "recording", folderPath, autoStart } });
      setFoldersDrawerOpen(false);
    },
    [selectFolderForMobile]
  );

  // Deep link listener — opens recording screen when type2://record is received
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/plugin-deep-link")
      .then(({ onOpenUrl }) =>
        onOpenUrl((urls: string[]) => {
          for (const url of urls) {
            if (url.includes("record")) {
              openRecordingRoute(UNSORTED_FOLDER_PATH, true);
              break;
            }
          }
        })
      )
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Deep link plugin not available (e.g. desktop/dev)
      });
    return () => unlisten?.();
  }, [openRecordingRoute]);

  const handleEdgeSwipeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (layoutMode !== "phone" || foldersDrawerOpen) {
        return;
      }
      if (event.clientX > 24) {
        edgeSwipeStart.current = null;
        return;
      }
      edgeSwipeTriggered.current = false;
      edgeSwipeStart.current = { x: event.clientX, y: event.clientY };
    },
    [foldersDrawerOpen, layoutMode]
  );

  const handleEdgeSwipeMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (layoutMode !== "phone" || foldersDrawerOpen) {
        return;
      }
      const start = edgeSwipeStart.current;
      if (!start || edgeSwipeTriggered.current) {
        return;
      }
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (dx > 84 && Math.abs(dy) < 42) {
        edgeSwipeTriggered.current = true;
        void popRoute();
      }
    },
    [foldersDrawerOpen, layoutMode, popRoute]
  );

  const handleEdgeSwipeEnd = useCallback(() => {
    edgeSwipeStart.current = null;
    edgeSwipeTriggered.current = false;
  }, []);

  const openFolderActionSheet = useCallback(
    (path: string) => {
      const folderName = path.split("/").pop() || path;
      const isSystemFolder = SYSTEM_FOLDER_PATHS.has(path);
      setSheetContext({ type: "folder", path });
      setSheetState({
        open: true,
        title: "Folder actions",
        subtitle: getDisplayFolderName(folderName),
        actions: [
          {
            id: "folder.rename",
            label: isSystemFolder ? "Rename (Unavailable)" : "Rename",
            disabled: isSystemFolder,
          },
          {
            id: "folder.delete",
            label: isSystemFolder ? "Delete (Unavailable)" : "Delete",
            destructive: true,
            disabled: isSystemFolder,
          },
        ],
      });
    },
    []
  );

  const openNoteActionSheet = useCallback(
    (path: string) => {
      setSheetContext({ type: "note", path });
      setSheetState({
        open: true,
        title: "Note actions",
        subtitle: (path.split("/").pop() || path).replace(/\.md$/i, ""),
        actions: [
          { id: "note.info", label: "Info" },
          { id: "note.archive", label: "Archive" },
          { id: "note.delete", label: "Delete", destructive: true },
        ],
      });
    },
    []
  );

  const onDeleteFolder = useCallback(async (path: string) => {
    await deleteFolders([path]);
  }, [deleteFolders]);

  const onDeleteNote = useCallback(async (path: string) => {
    return deleteNotes([path]);
  }, [deleteNotes]);

  const onArchiveNote = useCallback(async (path: string) => {
    await moveNotesToArchive([path]);
  }, [moveNotesToArchive]);

  const onToggleFolder = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, [setExpanded]);

  const onSheetSelect = useCallback(
    async (actionId: string) => {
      const context = sheetContext;
      closeActionSheet();
      if (!context) {
        return;
      }
      try {
        if (context.type === "folder") {
          if (actionId === "folder.rename") {
            setRenamePrompt({
              path: context.path,
              currentName: context.path.split("/").pop() || context.path,
            });
            return;
          }
          if (actionId === "folder.delete") {
            await onDeleteFolder(context.path);
            showToast("Folder deleted", "success");
            return;
          }
          return;
        }

        if (actionId === "note.info") {
          await showNoteInfo(context.path);
          return;
        }
        if (actionId === "note.archive") {
          await onArchiveNote(context.path);
          showToast("Moved to Archive", "success");
          return;
        }
        if (actionId === "note.delete") {
          const deleted = await onDeleteNote(context.path);
          if (deleted) {
            showToast("Note deleted", "success");
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showToast(message, "error");
      }
    },
    [
      closeActionSheet,
      onArchiveNote,
      onDeleteFolder,
      onDeleteNote,
      showNoteInfo,
      sheetContext,
      showToast,
    ]
  );

  const settingsScreen = (
    <MobileSettingsScreen
      activeSection={activeSettingsSection}
      onSectionChange={onSettingsSectionChange}
      sections={MOBILE_SETTINGS_SECTIONS}
    />
  );

  const phoneContent = useMemo(() => {
    if (currentRoute.kind === "home") {
      return (
        <MobileEditorScreen
          markdown={editorMarkdown}
          onChange={handleEditorChange}
          hasActiveNote={false}
          isSaving={false}
          saveError={null}
          keyboardInset={keyboardInset}
          onRetrySave={() => Promise.resolve()}
          draftMode
          onPullUpCreate={async () => {
            const draft = editorMarkdown.trimEnd();
            const path = await createNewNote(undefined, draft);
            if (!path) {
              return;
            }
            nextTransitionRef.current = "up";
            openEditorRoute(path);
          }}
        />
      );
    }

    if (currentRoute.kind === "folders") {
      if (navigationTab === "recent") {
        return (
          <MobileRecentScreen
            buckets={recentBuckets.map((bucket) => ({
              id: bucket.id,
              label: bucket.label,
              subtitle: bucket.subtitle,
              count: bucket.notes.length,
            }))}
            onSelect={openRecentBucketRoute}
          />
        );
      }
      return (
        <MobileFoldersScreen
          items={navigationFolders}
          activeFolder={activeFolder}
          expanded={expanded}
          onToggle={onToggleFolder}
          onSelect={openNotesRoute}
          onLongPress={openFolderActionSheet}
        />
      );
    }

    if (currentRoute.kind === "notes") {
      return (
        <MobileNotesScreen
          folderTitle={activeFolderTitle}
          notes={notes}
          previews={notePreviews}
          activeNote={activeNote}
          onSelect={(path) => {
            openEditorRoute(path, currentRoute.folderPath);
          }}
          onCreate={() => {
            void (async () => {
              const path = await createNewNote(currentRoute.folderPath);
              if (!path) {
                return;
              }
              openEditorRoute(path, currentRoute.folderPath);
            })();
          }}
          onDelete={(path) => {
            void (async () => {
              try {
                const deleted = await onDeleteNote(path);
                if (deleted) {
                  showToast("Note deleted", "success");
                }
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                showToast(message, "error");
              }
            })();
          }}
          onArchive={(path) => {
            void (async () => {
              try {
                await onArchiveNote(path);
                showToast("Moved to Archive", "success");
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                showToast(message, "error");
              }
            })();
          }}
          onLongPress={openNoteActionSheet}
          onContextMenu={(event, path) => {
            void onNoteContextMenu(event, path, currentRoute.folderPath);
          }}
          onPullRefresh={async () => {
            await refreshNotesFeed(currentRoute.folderPath);
          }}
          emptyStateText={`No notes in ${getDisplayRouteTitle(activeFolderTitle)}.`}
          createButtonLabel="Create note"
        />
      );
    }

    if (currentRoute.kind === "recent-date") {
      const bucket = recentBucketById.get(currentRoute.bucketId);
      const bucketNotes = bucket?.notes ?? [];
      const bucketTitle = bucket?.label ?? "Recent";
      return (
        <MobileNotesScreen
          folderTitle={bucketTitle}
          notes={bucketNotes}
          previews={allNotePreviews}
          activeNote={activeNote}
          onSelect={(path) => {
            openEditorRoute(path);
          }}
          onCreate={() => {
            void (async () => {
              const path = await createNewNote(undefined, "", bucket?.dayEndMs ?? undefined);
              if (!path) {
                return;
              }
              openEditorRoute(path);
            })();
          }}
          onDelete={(path) => {
            void (async () => {
              try {
                const deleted = await onDeleteNote(path);
                if (deleted) {
                  showToast("Note deleted", "success");
                }
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                showToast(message, "error");
              }
            })();
          }}
          onArchive={(path) => {
            void (async () => {
              try {
                await onArchiveNote(path);
                showToast("Moved to Archive", "success");
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                showToast(message, "error");
              }
            })();
          }}
          onLongPress={openNoteActionSheet}
          onContextMenu={(event, path) => {
            void onNoteContextMenu(event, path);
          }}
          onPullRefresh={async () => {
            await refreshTree();
          }}
          emptyStateText={`No notes in ${bucketTitle}.`}
          createButtonLabel="Create note"
        />
      );
    }

    if (currentRoute.kind === "recording") {
      return (
        <MobileRecordingScreen
          recordingSupported={recordingSupported}
          isRecording={isRecordingAudio}
          isBusy={isRecordingBusy}
          recordingError={recorderError}
          recordingStatus={recordingStatusMessage}
          recordingLiveStatus={recordingLiveStatus}
          hasAssemblyApiKey={syncSettings.assemblyAiApiKey.trim().length > 0}
          onStart={() => startRecording(currentRoute.folderPath)}
          onStop={stopRecording}
          onQueue={() => void queueRecordingTranscriptions("manual")}
          autoStart={currentRoute.autoStart}
        />
      );
    }

    if (currentRoute.kind === "editor") {
      return (
        <MobileEditorScreen
          markdown={editorMarkdown}
          onChange={handleEditorChange}
          hasActiveNote={hasActiveNote}
          isSaving={isNoteSaving}
          saveError={noteSaveError}
          keyboardInset={keyboardInset}
          onRetrySave={() => {
            void retrySave();
          }}
          onPullUpCreate={async () => {
            const path = await createNewNote(currentRoute.folderPath);
            if (!path) {
              return;
            }
            const folderPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
            nextTransitionRef.current = "up";
            dispatch({
              type: "replace",
              route: {
                kind: "editor",
                folderPath,
                notePath: path,
              },
            });
          }}
        />
      );
    }

    return settingsScreen;
  }, [
    activeFolder,
    activeFolderTitle,
    activeNote,
    allNotePreviews,
    syncSettings.assemblyAiApiKey,
    currentRoute,
    editorMarkdown,
    expanded,
    hasActiveNote,
    isRecordingAudio,
    isRecordingBusy,
    isNoteSaving,
    keyboardInset,
    navigationFolders,
    navigationTab,
    notePreviews,
    notes,
    onArchiveNote,
    createNewNote,
    onDeleteNote,
    handleEditorChange,
    onNoteContextMenu,
    queueRecordingTranscriptions,
    refreshTree,
    startRecording,
    stopRecording,
    openEditorRoute,
    openFolderActionSheet,
    openNoteActionSheet,
    openNotesRoute,
    openRecentBucketRoute,
    retrySave,
    onToggleFolder,
    recentBucketById,
    recentBuckets,
    recorderError,
    recordingLiveStatus,
    recordingStatusMessage,
    refreshNotesFeed,
    noteSaveError,
    settingsScreen,
    showToast,
  ]);

  const phoneTitle =
    currentRoute.kind === "home"
      ? "Notes"
      : currentRoute.kind === "folders"
      ? navigationTab === "recent"
        ? "Recent"
        : "Folders"
      : currentRoute.kind === "notes"
        ? getDisplayRouteTitle(activeFolderTitle)
        : currentRoute.kind === "recent-date"
          ? recentBucketById.get(currentRoute.bucketId)?.label ?? "Recent"
        : currentRoute.kind === "recording"
          ? "New recording"
        : currentRoute.kind === "editor"
          ? activeNoteTitle
          : "Settings";

  const phoneLeftAction =
    currentRoute.kind === "home"
      ? {
          label: "Folders",
          icon: <Menu size={18} />,
          onPress: () => setFoldersDrawerOpen(true),
        }
      : currentRoute.kind === "folders"
        ? {
            label: "Back",
            icon: <ChevronLeft size={18} />,
            onPress: () => dispatch({ type: "replace", route: { kind: "home" } }),
          }
      : {
          label: "Back",
          icon: <ChevronLeft size={18} />,
          onPress: () => {
            void popRoute();
          },
        };

  const phoneRightActions =
    currentRoute.kind === "home" || currentRoute.kind === "folders"
      ? [
          {
            label: "Settings",
            icon: <Settings size={18} />,
            onPress: () => dispatch({ type: "push", route: { kind: "settings" } }),
          },
        ]
      : currentRoute.kind === "notes"
        ? [
            {
              label: "New note",
              icon: <Plus size={18} />,
              onPress: () => {
                void (async () => {
                  const path = await createNewNote(currentRoute.folderPath);
                  if (!path) {
                    return;
                  }
                  openEditorRoute(path, currentRoute.folderPath);
                })();
              },
            },
            {
              label: "Record",
              icon: <Mic size={18} />,
              onPress: () => {
                openRecordingRoute(currentRoute.folderPath);
              },
            },
          ]
        : currentRoute.kind === "recent-date"
          ? [
              {
                label: "New note",
                icon: <Plus size={18} />,
                onPress: () => {
                  void (async () => {
                    const bucket = recentBucketById.get(currentRoute.bucketId);
                    const path = await createNewNote(undefined, "", bucket?.dayEndMs ?? undefined);
                    if (!path) {
                      return;
                    }
                    openEditorRoute(path);
                  })();
                },
              },
            ]
          : [];

  const tabletNotesPane = (
    <MobileNotesScreen
      folderTitle={activeFolderTitle}
      notes={notes}
      previews={notePreviews}
      activeNote={activeNote}
      onSelect={selectNoteForMobile}
      onCreate={() => {
        void (async () => {
          await createNewNote(activeFolder);
        })();
      }}
      onDelete={(path) => {
        void (async () => {
          try {
            const deleted = await onDeleteNote(path);
            if (deleted) {
              showToast("Note deleted", "success");
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showToast(message, "error");
          }
        })();
      }}
      onArchive={(path) => {
        void (async () => {
          try {
            await onArchiveNote(path);
            showToast("Moved to Archive", "success");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showToast(message, "error");
          }
        })();
      }}
      onLongPress={openNoteActionSheet}
      onContextMenu={(event, path) => {
        void onNoteContextMenu(event, path, activeFolder);
      }}
      onPullRefresh={async () => {
        await refreshNotesFeed(activeFolder);
      }}
      emptyStateText={`No notes in ${getDisplayRouteTitle(activeFolderTitle)}.`}
      createButtonLabel="Create note"
    />
  );

  const tabletFoldersPane = (
    tabletLeftMode === "folders" ? (
      notesListMode === "nested" ? (
        <div className="mobile-tablet-left-content mobile-tablet-left-content-nested">
          <div className="mobile-tablet-left-folders">
            <div className="mobile-tablet-folders-nav">
              <div className="mobile-tablet-folders-list">
                <MobileFoldersScreen
                  items={navigationFolders}
                  activeFolder={activeFolder}
                  expanded={expanded}
                  onToggle={onToggleFolder}
                  onSelect={selectFolderForMobile}
                  onLongPress={openFolderActionSheet}
                />
              </div>
              <button
                type="button"
                className={`mobile-tablet-archive-btn${activeFolder === ARCHIVE_FOLDER_PATH ? " active" : ""}`}
                onClick={() => selectFolderForMobile(ARCHIVE_FOLDER_PATH)}
              >
                <Archive size={16} />
                <span>Archive</span>
              </button>
            </div>
          </div>
          <div className="mobile-tablet-left-notes">{tabletNotesPane}</div>
        </div>
      ) : (
        <div className="mobile-tablet-left-content">
          <div className="mobile-tablet-folders-nav">
            <div className="mobile-tablet-folders-list">
              <MobileFoldersScreen
                items={navigationFolders}
                activeFolder={activeFolder}
                expanded={expanded}
                onToggle={onToggleFolder}
                onSelect={selectFolderForMobile}
                onLongPress={openFolderActionSheet}
              />
            </div>
            <button
              type="button"
              className={`mobile-tablet-archive-btn${activeFolder === ARCHIVE_FOLDER_PATH ? " active" : ""}`}
              onClick={() => selectFolderForMobile(ARCHIVE_FOLDER_PATH)}
            >
              <Archive size={16} />
              <span>Archive</span>
            </button>
          </div>
        </div>
      )
    ) : (
      <div className="mobile-tablet-settings-sections" role="tablist" aria-label="Settings sections">
        {MOBILE_SETTINGS_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`mobile-tablet-settings-btn${activeSettingsSection === section.id ? " active" : ""}`}
            onClick={() => onSettingsSectionChange(section.id)}
          >
            {section.label}
          </button>
        ))}
      </div>
    )
  );

  const tabletRightContent =
    tabletLeftMode === "settings" ? (
      <div className="mobile-tablet-settings-content">{settingsScreen}</div>
    ) : notesListMode === "nested" ? (
      <div className="mobile-tablet-editor-only mobile-tablet-pane">
        <MobileEditorScreen
          markdown={editorMarkdown}
          onChange={handleEditorChange}
          hasActiveNote={hasActiveNote}
          isSaving={isNoteSaving}
          saveError={noteSaveError}
          keyboardInset={keyboardInset}
          onRetrySave={() => {
            void retrySave();
          }}
        />
      </div>
    ) : (
      <div className="mobile-tablet-right-split mobile-tablet-right-split-notes">
        <div className="mobile-tablet-notes-pane mobile-tablet-pane">{tabletNotesPane}</div>
        <div className="mobile-tablet-editor-pane mobile-tablet-pane">
          <MobileEditorScreen
            markdown={editorMarkdown}
            onChange={handleEditorChange}
            hasActiveNote={hasActiveNote}
            isSaving={isNoteSaving}
            saveError={noteSaveError}
            keyboardInset={keyboardInset}
            onRetrySave={() => {
              void retrySave();
            }}
          />
        </div>
      </div>
    );

  return (
    <div
      className={`mobile-root theme-${theme}`}
      data-layout={layoutMode}
      style={appStyle}
      onPointerDown={handleEdgeSwipeStart}
      onPointerMove={handleEdgeSwipeMove}
      onPointerUp={handleEdgeSwipeEnd}
      onPointerCancel={handleEdgeSwipeEnd}
    >
      {layoutMode === "phone" ? (
        <>
          <MobileNavBar
            title={phoneTitle}
            leftAction={phoneLeftAction}
            rightActions={phoneRightActions}
          />
          <main className="mobile-screen">
            <div
              key={
                currentRoute.kind === "home"
                  ? "home"
                  : currentRoute.kind === "folders"
                  ? "folders"
                  : currentRoute.kind === "notes"
                    ? `notes:${currentRoute.folderPath}`
                    : currentRoute.kind === "recent-date"
                      ? `recent:${currentRoute.bucketId}`
                    : currentRoute.kind === "editor"
                      ? `editor:${currentRoute.notePath}`
                      : currentRoute.kind === "recording"
                        ? `recording:${currentRoute.folderPath}`
                      : `settings:${currentRoute.section || "root"}`
              }
              className={`mobile-screen-stage ${phoneTransitionDirection === "forward" ? "forward" : phoneTransitionDirection === "up" ? "up" : "backward"}`}
            >
              {phoneContent}
            </div>
          </main>
          {currentRoute.kind === "home" ? (
            <button
              type="button"
              className="mobile-home-mic-fab"
              aria-label="Start recording"
              onClick={() => {
                openRecordingRoute();
              }}
            >
              <Mic size={20} />
            </button>
          ) : null}
          {foldersDrawerOpen ? (
            <div className="mobile-drawer-overlay" role="dialog" aria-modal="true" aria-label="Navigation">
              <button
                type="button"
                className="mobile-drawer-backdrop"
                onClick={() => setFoldersDrawerOpen(false)}
                aria-label="Close navigation"
              />
              <aside className="mobile-drawer-panel">
                <div className="mobile-drawer-header">
                  <h2>Navigation</h2>
                  <button
                    type="button"
                    className="mobile-drawer-close"
                    onClick={() => setFoldersDrawerOpen(false)}
                    aria-label="Close navigation"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="mobile-drawer-content">
                  <div className="mobile-drawer-tabs" role="tablist" aria-label="Navigation tabs">
                    <button
                      type="button"
                      className={`mobile-drawer-tab${navigationTab === "folders" ? " active" : ""}`}
                      onClick={() => setNavigationTab("folders")}
                    >
                      <Folder size={15} />
                      <span>Folders</span>
                    </button>
                    <button
                      type="button"
                      className={`mobile-drawer-tab${navigationTab === "recent" ? " active" : ""}`}
                      onClick={() => setNavigationTab("recent")}
                    >
                      <Clock3 size={15} />
                      <span>Recent</span>
                    </button>
                  </div>
                  <div className="mobile-drawer-main">
                    {navigationTab === "folders" ? (
                      <MobileFoldersScreen
                        items={navigationFolders}
                        activeFolder={activeFolder}
                        expanded={expanded}
                        onToggle={onToggleFolder}
                        onSelect={openNotesRoute}
                        onLongPress={openFolderActionSheet}
                      />
                    ) : (
                      <MobileRecentScreen
                        buckets={recentBuckets.map((bucket) => ({
                          id: bucket.id,
                          label: bucket.label,
                          subtitle: bucket.subtitle,
                          count: bucket.notes.length,
                        }))}
                        onSelect={openRecentBucketRoute}
                      />
                    )}
                  </div>
                  <div className="mobile-drawer-footer">
                    <button
                      type="button"
                      className="mobile-drawer-archive-btn"
                      onClick={openArchiveRoute}
                    >
                      <Archive size={16} />
                      <span>Archive</span>
                    </button>
                  </div>
                </div>
              </aside>
            </div>
          ) : null}
        </>
      ) : (
        <div
          className={`mobile-tablet-shell mobile-tablet-shell-${tabletLeftMode} mobile-tablet-mode-${notesListMode}`}
        >
          <aside className="mobile-tablet-left">
            <MobileNavBar title="Navigation" />
            <MobileTabBar
              items={TABLET_LEFT_ITEMS.map((item) => ({
                id: item.id,
                label: item.label,
                icon: item.icon,
              }))}
              activeId={tabletLeftMode}
              onSelect={(id) => {
                if (id === "folders" || id === "settings") {
                  setTabletLeftMode(id);
                }
              }}
            />
            {tabletFoldersPane}
          </aside>
          <section
            className={`mobile-tablet-right mobile-tablet-right-${tabletLeftMode} mobile-tablet-right-mode-${notesListMode}`}
          >
            {tabletRightContent}
          </section>
        </div>
      )}

      <MobileActionSheet state={sheetState} onClose={closeActionSheet} onSelect={(id) => void onSheetSelect(id)} />
      <MobilePromptSheet
        open={Boolean(renamePrompt)}
        title="Rename folder"
        subtitle={
          renamePrompt
            ? `Current name: ${getDisplayFolderName(renamePrompt.currentName)}`
            : undefined
        }
        initialValue={renamePrompt?.currentName || ""}
        placeholder="Folder name"
        confirmLabel="Rename"
        onClose={() => setRenamePrompt(null)}
        onConfirm={async (nextName) => {
          if (!renamePrompt) {
            return;
          }
          try {
            await renameFolderFromMobile(renamePrompt.path, nextName);
            setRenamePrompt(null);
            showToast("Folder renamed", "success");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showToast(message, "error");
          }
        }}
      />
      <MobileToast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
