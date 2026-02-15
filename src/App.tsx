import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu } from "@tauri-apps/api/menu";
import { Settings } from "lucide-react";
import "./App.css";
import "./mobile/mobile.css";

// Data layer
import * as api from "./data/notesApi";

// Hooks
import { useNoteEditor } from "./hooks/useNoteEditor";
import { useNotePreviews } from "./hooks/useNotePreviews";
import { useAudioRecorder } from "./hooks/useAudioRecorder";

// Components
import { DROP_PREFIX, FoldersPanel } from "./components/FoldersPanel";
import { NoteRow } from "./components/NoteRow";
import { NoteEditor } from "./components/NoteEditor";
import {
  SettingsMiddlePane,
  SettingsDetailPane,
  type SettingsSectionId,
  type NotesListMode,
  type ThemeMode,
} from "./components/SettingsPanel";
import { DesktopShell } from "./desktop/DesktopShell";
import { MobileShell } from "./mobile/MobileShell";
import { useLayoutMode } from "./mobile/useLayoutMode";
import { useKeyboardInsets } from "./mobile/useKeyboardInsets";

// Utils
import {
  buildTreeItems,
  findNode,
  findParentAndIndex,
  getNodeById,
  removeNodes,
  insertNodes,
  parseDropTargetId,
  sortIdsByTreeOrder,
  isInDraggedSubtree,
  getTopLevelSelected,
  arraysEqual,
  buildFolderOrderMap,
  applyFolderOrder,
  buildNoteOrderMap,
  reorderList,
  flattenTree,
} from "./utils/treeOps";
import { focusNoScroll, scrollIntoViewIfNeeded, escapeSelectorValue, confirmAction } from "./utils/dom";
import { getNextNoteFileName } from "./utils/format";

// Types
import type {
  DragData,
  FolderNode,
  GitSyncStatus,
  NotesSessionSnapshot,
  RecordingListItem,
  RecordingQueueSnapshot,
} from "./types";
import type { TreeItem } from "./tree/types";
import { removeChildrenOf } from "./tree/utilities";

const indentationWidth = 18;
const UNSORTED_FOLDER_PATH = "Unsorted";
const ARCHIEVE_FOLDER_PATH = "Archieve";
const SYSTEM_FOLDER_PATHS = new Set([UNSORTED_FOLDER_PATH, ARCHIEVE_FOLDER_PATH]);

type AppMode = "notes" | "settings";
type PaneId = "folders" | "middle" | "right";
type GitSyncAction = "idle" | "refresh" | "connect" | "pull" | "push";
type VisibleNavigationItem =
  | {
      type: "folder";
      id: string;
      parentId: string | null;
    }
  | {
      type: "note";
      id: string;
      parentId: string;
    };

const getInitialTheme = (): ThemeMode => {
  if (typeof window === "undefined") {
    return "dark";
  }
  const stored = window.localStorage.getItem("notes-viewer-theme");
  if (stored === "dark" || stored === "light") {
    return stored;
  }
  return "dark";
};

const getInitialNotesListMode = (): NotesListMode => {
  if (typeof window === "undefined") {
    return "separate";
  }
  const stored = window.localStorage.getItem("notes-viewer-notes-list-mode");
  if (stored === "nested" || stored === "separate") {
    return stored;
  }
  return "separate";
};

const getStoredSyncValue = (key: string, fallback: string) => {
  if (typeof window === "undefined") {
    return fallback;
  }
  const stored = window.localStorage.getItem(key);
  return stored && stored.trim().length > 0 ? stored : fallback;
};

type SessionSyncSettings = {
  gitRemoteUrl: string;
  gitBranch: string;
  gitUsername: string;
  gitPassword: string;
  gitCommitMessage: string;
  lastSuccessfulSyncAt: string;
  assemblyAiApiKey: string;
};

const SESSION_SYNC_STORAGE_KEY = "notes-viewer-session-sync-settings";

const DEFAULT_SESSION_SYNC_SETTINGS: SessionSyncSettings = {
  gitRemoteUrl: "",
  gitBranch: "main",
  gitUsername: "",
  gitPassword: "",
  gitCommitMessage: "Sync notes",
  lastSuccessfulSyncAt: "",
  assemblyAiApiKey: "",
};

const readSessionSyncStore = (): Record<string, Partial<SessionSyncSettings>> => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(SESSION_SYNC_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, Partial<SessionSyncSettings>>;
    }
  } catch {
    return {};
  }
  return {};
};

const writeSessionSyncStore = (store: Record<string, Partial<SessionSyncSettings>>) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SESSION_SYNC_STORAGE_KEY, JSON.stringify(store));
};

const getSessionSyncSettings = (sessionId: string): SessionSyncSettings => {
  const store = readSessionSyncStore();
  const stored = store[sessionId] ?? {};
  const legacyFallback =
    sessionId === "default"
      ? {
          gitRemoteUrl: getStoredSyncValue("notes-viewer-git-remote", ""),
          gitBranch: getStoredSyncValue("notes-viewer-git-branch", "main"),
          gitUsername: getStoredSyncValue("notes-viewer-git-username", ""),
          gitPassword: getStoredSyncValue("notes-viewer-git-password", ""),
          gitCommitMessage: getStoredSyncValue("notes-viewer-git-commit-message", "Sync notes"),
          lastSuccessfulSyncAt: getStoredSyncValue("notes-viewer-git-last-sync-at", ""),
          assemblyAiApiKey: getStoredSyncValue("notes-viewer-assemblyai-api-key", ""),
        }
      : {};

  return {
    gitRemoteUrl: stored.gitRemoteUrl ?? legacyFallback.gitRemoteUrl ?? DEFAULT_SESSION_SYNC_SETTINGS.gitRemoteUrl,
    gitBranch: stored.gitBranch ?? legacyFallback.gitBranch ?? DEFAULT_SESSION_SYNC_SETTINGS.gitBranch,
    gitUsername: stored.gitUsername ?? legacyFallback.gitUsername ?? DEFAULT_SESSION_SYNC_SETTINGS.gitUsername,
    gitPassword: stored.gitPassword ?? legacyFallback.gitPassword ?? DEFAULT_SESSION_SYNC_SETTINGS.gitPassword,
    gitCommitMessage:
      stored.gitCommitMessage ??
      legacyFallback.gitCommitMessage ??
      DEFAULT_SESSION_SYNC_SETTINGS.gitCommitMessage,
    lastSuccessfulSyncAt:
      stored.lastSuccessfulSyncAt ??
      legacyFallback.lastSuccessfulSyncAt ??
      DEFAULT_SESSION_SYNC_SETTINGS.lastSuccessfulSyncAt,
    assemblyAiApiKey:
      stored.assemblyAiApiKey ??
      legacyFallback.assemblyAiApiKey ??
      DEFAULT_SESSION_SYNC_SETTINGS.assemblyAiApiKey,
  };
};

const getNoteParentPath = (notePath: string) => {
  const slashIndex = notePath.lastIndexOf("/");
  return slashIndex === -1 ? "" : notePath.slice(0, slashIndex);
};

const yieldToUi = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

const toBase64 = (bytes: Uint8Array) => {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const isSystemFolder = (path: string) => SYSTEM_FOLDER_PATHS.has(path);
const MOBILE_SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string }> = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "sync", label: "Sync" },
  { id: "recordings", label: "Recordings" },
];

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  // -- Theme & layout -------------------------------------------------------
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [notesListMode, setNotesListMode] =
    useState<NotesListMode>(getInitialNotesListMode);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [threePaneLayout, setThreePaneLayout] = useState<Record<string, number>>({
    nav: 22,
    middle: 25,
    content: 53,
  });
  const [twoPaneLayout, setTwoPaneLayout] = useState<Record<string, number>>({
    nav: 29,
    content: 71,
  });
  const [editorFontSize, setEditorFontSize] = useState(14);
  const [appMode, setAppMode] = useState<AppMode>("notes");
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSectionId>("general");
  const [sessionsSnapshot, setSessionsSnapshot] =
    useState<NotesSessionSnapshot | null>(null);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [syncSettingsSessionId, setSyncSettingsSessionId] = useState<string | null>(
    null
  );
  const [gitRemoteUrl, setGitRemoteUrl] = useState(
    DEFAULT_SESSION_SYNC_SETTINGS.gitRemoteUrl
  );
  const [gitBranch, setGitBranch] = useState(
    DEFAULT_SESSION_SYNC_SETTINGS.gitBranch
  );
  const [gitUsername, setGitUsername] = useState(
    DEFAULT_SESSION_SYNC_SETTINGS.gitUsername
  );
  const [gitPassword, setGitPassword] = useState(
    DEFAULT_SESSION_SYNC_SETTINGS.gitPassword
  );
  const [gitCommitMessage, setGitCommitMessage] = useState(
    DEFAULT_SESSION_SYNC_SETTINGS.gitCommitMessage
  );
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState(
    DEFAULT_SESSION_SYNC_SETTINGS.lastSuccessfulSyncAt
  );
  const [assemblyAiApiKey, setAssemblyAiApiKey] = useState(
    DEFAULT_SESSION_SYNC_SETTINGS.assemblyAiApiKey
  );
  const [gitStatus, setGitStatus] = useState<GitSyncStatus | null>(null);
  const [gitSyncAction, setGitSyncAction] = useState<GitSyncAction>("idle");
  const [gitSyncError, setGitSyncError] = useState<string | null>(null);
  const [recordingStatusMessage, setRecordingStatusMessage] = useState<string | null>(null);
  const [transcriptionQueueBusy, setTranscriptionQueueBusy] = useState(false);
  const [recordingsQueue, setRecordingsQueue] = useState<RecordingQueueSnapshot | null>(null);
  const [recordingsList, setRecordingsList] = useState<RecordingListItem[]>([]);
  const [recordingsBusy, setRecordingsBusy] = useState(false);
  const [recordingsError, setRecordingsError] = useState<string | null>(null);
  const [activeAudioPath, setActiveAudioPath] = useState<string | null>(null);
  const [activeAudioSrc, setActiveAudioSrc] = useState<string | null>(null);

  const layoutMode = useLayoutMode();
  const { keyboardInset } = useKeyboardInsets();
  const sessions = sessionsSnapshot?.sessions ?? [];
  const activeSessionId = sessionsSnapshot?.active_session_id ?? null;

  // -- Folder tree state ----------------------------------------------------
  const [tree, setTree] = useState<FolderNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [lastSelectedFolder, setLastSelectedFolder] = useState("");
  const [activeFolder, setActiveFolder] = useState("");

  // -- Note selection state -------------------------------------------------
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const [lastSelectedNote, setLastSelectedNote] = useState("");
  const [activeNote, setActiveNote] = useState<string | null>(null);

  // -- Rename state ---------------------------------------------------------
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // -- Drag-drop state ------------------------------------------------------
  const [activeId, setActiveId] = useState<string | null>(null);
  const [edgeSnap, setEdgeSnap] = useState<{
    id: string;
    position: "before" | "after";
  } | null>(null);
  const activeDrag = useRef<DragData | null>(null);
  const dragStartPoint = useRef<{ x: number; y: number } | null>(null);
  const expandTimeoutRef = useRef<number | null>(null);
  const expandTargetRef = useRef<string | null>(null);

  // -- Refs -----------------------------------------------------------------
  const notesPanelRef = useRef<HTMLDivElement | null>(null);
  const foldersPanelRef = useRef<HTMLDivElement | null>(null);
  const middlePaneRef = useRef<HTMLDivElement | null>(null);
  const rightPaneRef = useRef<HTMLDivElement | null>(null);
  const lastLeftPaneFocusRef = useRef<"folders" | "middle">("middle");
  const folderContextPathRef = useRef<string | null>(null);
  const noteContextPathRef = useRef<string | null>(null);
  const selectedFoldersRef = useRef<Set<string>>(new Set());
  const selectedNotesRef = useRef<Set<string>>(new Set());
  const folderMenuPromiseRef = useRef<Promise<Menu> | null>(null);
  const noteMenuPromiseRef = useRef<Promise<Menu> | null>(null);
  const transcriptionQueueBusyRef = useRef(false);
  const recordingTargetFolderRef = useRef<string>(UNSORTED_FOLDER_PATH);

  // -- Hooks ----------------------------------------------------------------
  const {
    noteContent,
    draftNoteContent,
    isSaving: isNoteSaving,
    saveError: noteSaveError,
    handleEditorChange,
    clearNote,
    clearDraft,
    flushSave,
    retrySave,
  } = useNoteEditor(activeNote);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // -- Sync refs to state ---------------------------------------------------
  useEffect(() => {
    console.log("[folders] selectedFolders", Array.from(selectedFolders));
    selectedFoldersRef.current = selectedFolders;
  }, [selectedFolders]);

  useEffect(() => {
    selectedNotesRef.current = selectedNotes;
  }, [selectedNotes]);

  // -- Theme persistence ----------------------------------------------------
  useEffect(() => {
    window.localStorage.setItem("notes-viewer-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("notes-viewer-notes-list-mode", notesListMode);
  }, [notesListMode]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    const settings = getSessionSyncSettings(activeSessionId);
    setGitRemoteUrl(settings.gitRemoteUrl);
    setGitBranch(settings.gitBranch);
    setGitUsername(settings.gitUsername);
    setGitPassword(settings.gitPassword);
    setGitCommitMessage(settings.gitCommitMessage);
    setLastSuccessfulSyncAt(settings.lastSuccessfulSyncAt);
    setAssemblyAiApiKey(settings.assemblyAiApiKey);
    setSyncSettingsSessionId(activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId || syncSettingsSessionId !== activeSessionId) {
      return;
    }
    const store = readSessionSyncStore();
    store[activeSessionId] = {
      gitRemoteUrl,
      gitBranch,
      gitUsername,
      gitPassword,
      gitCommitMessage,
      lastSuccessfulSyncAt,
      assemblyAiApiKey,
    };
    writeSessionSyncStore(store);
  }, [
    activeSessionId,
    assemblyAiApiKey,
    gitBranch,
    gitCommitMessage,
    gitPassword,
    gitRemoteUrl,
    gitUsername,
    lastSuccessfulSyncAt,
    syncSettingsSessionId,
  ]);

  // -- Debug logging --------------------------------------------------------
  useEffect(() => {
    console.log("[folders] activeFolder", activeFolder);
  }, [activeFolder]);

  // -- Tree data ------------------------------------------------------------
  const refreshSessions = useCallback(async () => {
    const snapshot = await api.getSessions();
    setSessionsSnapshot(snapshot);
    return snapshot;
  }, []);

  const refreshTree = useCallback(async () => {
    const data = await api.getTree();
    setTree(data);
  }, []);

  const refreshGitStatus = useCallback(async () => {
    setGitSyncAction("refresh");
    await yieldToUi();
    try {
      const status = await api.getGitStatus();
      setGitStatus(status);
      setGitSyncError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitSyncError(message);
    } finally {
      setGitSyncAction("idle");
    }
  }, []);

  const refreshRecordings = useCallback(async () => {
    setRecordingsBusy(true);
    try {
      const snapshot = await api.listRecordings();
      setRecordingsQueue(snapshot.queue);
      setRecordingsList(snapshot.recordings);
      if (activeAudioPath) {
        const stillExists = snapshot.recordings.some(
          (item) => item.audio_path === activeAudioPath
        );
        if (!stillExists) {
          setActiveAudioPath(null);
          setActiveAudioSrc(null);
        }
      }
      setRecordingsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRecordingsError(message);
    } finally {
      setRecordingsBusy(false);
    }
  }, [activeAudioPath]);

  const playRecording = useCallback(async (audioPath: string) => {
    try {
      const payload = await api.readRecordingAudio(audioPath);
      setActiveAudioPath(audioPath);
      setActiveAudioSrc(`data:${payload.mime_type};base64,${payload.audio_base64}`);
      setRecordingsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRecordingsError(message);
    }
  }, []);

  const queueRecordingTranscriptions = useCallback(
    async (trigger: "manual" | "auto" = "manual") => {
      if (transcriptionQueueBusyRef.current) {
        return;
      }
      const apiKey = assemblyAiApiKey.trim();
      if (!apiKey) {
        if (trigger === "manual") {
          setRecordingStatusMessage("AssemblyAI API key is required.");
        }
        return;
      }

      transcriptionQueueBusyRef.current = true;
      setTranscriptionQueueBusy(true);
      try {
        const result = await api.queueRecordingTranscriptions(apiKey);
        const label =
          trigger === "manual"
            ? `Scanned ${result.scanned}, queued ${result.queued}, in-flight ${result.in_flight}.`
            : `Auto queue: scanned ${result.scanned}, queued ${result.queued}.`;
        setRecordingStatusMessage(label);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRecordingStatusMessage(message);
      } finally {
        transcriptionQueueBusyRef.current = false;
        setTranscriptionQueueBusy(false);
        void refreshRecordings();
      }
    },
    [assemblyAiApiKey, refreshRecordings]
  );

  const resolveRecordingTargetFolder = useCallback(
    (preferredFolderPath?: string | null) => {
      const preferred = preferredFolderPath?.trim();
      if (preferred) {
        return preferred;
      }
      const active = activeFolder.trim();
      return active || UNSORTED_FOLDER_PATH;
    },
    [activeFolder]
  );

  const handleRecordingReady = useCallback(
    async (blob: Blob, mimeType: string) => {
      const buffer = await blob.arrayBuffer();
      const audioBase64 = toBase64(new Uint8Array(buffer));
      const targetFolder = recordingTargetFolderRef.current || UNSORTED_FOLDER_PATH;
      const result = await api.saveAudioRecording(
        audioBase64,
        mimeType || undefined,
        targetFolder
      );
      await refreshTree();
      setSelectedFolders(new Set([result.folder_path]));
      setLastSelectedFolder(result.folder_path);
      setActiveFolder(result.folder_path);
      setSelectedNotes(new Set([result.note_path]));
      setLastSelectedNote(result.note_path);
      setActiveNote(result.note_path);
      clearDraft();
      setRecordingStatusMessage(`Saved ${result.note_path}.`);
      void refreshRecordings();
      if (layoutMode === "desktop") {
        await queueRecordingTranscriptions("auto");
      }
    },
    [
      clearDraft,
      layoutMode,
      queueRecordingTranscriptions,
      refreshRecordings,
      refreshTree,
    ]
  );

  const {
    isSupported: recordingSupported,
    isRecording: isRecordingAudio,
    isFinalizing: isRecordingFinalizing,
    error: recorderError,
    nativeRecoveryNotice,
    recordingElapsedLabel,
    startRecording: startRecordingRaw,
    stopRecording: stopRecordingRaw,
  } = useAudioRecorder({
    onRecordingReady: handleRecordingReady,
  });

  const startRecording = useCallback(
    (preferredFolderPath?: string | null) => {
      recordingTargetFolderRef.current =
        resolveRecordingTargetFolder(preferredFolderPath);
      void startRecordingRaw();
    },
    [resolveRecordingTargetFolder, startRecordingRaw]
  );

  const stopRecording = useCallback(() => {
    stopRecordingRaw();
  }, [stopRecordingRaw]);

  const recordingLiveStatus =
    isRecordingAudio && recordingElapsedLabel
      ? `${nativeRecoveryNotice ? `${nativeRecoveryNotice} ` : "Recording in progress. "}Elapsed ${recordingElapsedLabel}.`
      : null;

  useEffect(() => {
    void (async () => {
      setSessionsBusy(true);
      try {
        await refreshSessions();
        setSessionsError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSessionsError(message);
      } finally {
        setSessionsBusy(false);
      }
    })();
  }, [refreshSessions]);

  useEffect(() => {
    if (activeSessionId) {
      setTree(null);
      setGitStatus(null);
      setRecordingsQueue(null);
      setRecordingsList([]);
      setActiveAudioPath(null);
      setActiveAudioSrc(null);
      setRecordingStatusMessage(null);
      setRecordingsError(null);
      setGitSyncError(null);
      setSelectedFolders(new Set());
      setLastSelectedFolder("");
      setActiveFolder("");
      setSelectedNotes(new Set());
      setLastSelectedNote("");
      setActiveNote(null);
      recordingTargetFolderRef.current = UNSORTED_FOLDER_PATH;
      clearNote();
      clearDraft();
    }
    void refreshTree();
    void refreshGitStatus();
    if (appMode === "settings" && activeSettingsSection === "recordings") {
      void refreshRecordings();
    }
  }, [
    activeSettingsSection,
    activeSessionId,
    appMode,
    clearDraft,
    clearNote,
    refreshGitStatus,
    refreshRecordings,
    refreshTree,
  ]);

  useEffect(() => {
    if (appMode !== "settings" || activeSettingsSection !== "recordings") {
      return;
    }
    void refreshRecordings();
    const timer = window.setInterval(() => {
      void refreshRecordings();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [activeSettingsSection, appMode, refreshRecordings]);

  useEffect(() => {
    if (layoutMode !== "desktop" || !assemblyAiApiKey.trim()) {
      return;
    }
    void queueRecordingTranscriptions("auto");
    const timer = window.setInterval(() => {
      void queueRecordingTranscriptions("auto");
    }, 15000);
    return () => window.clearInterval(timer);
  }, [assemblyAiApiKey, layoutMode, queueRecordingTranscriptions]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        void flushSave();
      }
    };
    const handleBeforeUnload = () => {
      void flushSave();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [flushSave]);

  useEffect(() => {
    if (layoutMode === "desktop" || !tree || activeFolder) {
      return;
    }
    const unsorted = findNode(tree, UNSORTED_FOLDER_PATH);
    const firstFolderPath = unsorted?.path || tree.children[0]?.path || "";
    if (!firstFolderPath) {
      return;
    }
    setSelectedFolders(new Set([firstFolderPath]));
    setLastSelectedFolder(firstFolderPath);
    setActiveFolder(firstFolderPath);
  }, [activeFolder, layoutMode, tree]);

  const handleSwitchSession = useCallback(
    async (sessionId: string) => {
      const normalizedId = sessionId.trim();
      if (!normalizedId || normalizedId === activeSessionId) {
        return;
      }
      setSessionsBusy(true);
      try {
        await flushSave();
        const snapshot = await api.setActiveSession(normalizedId);
        setSessionsSnapshot(snapshot);
        setSessionsError(null);
        setAppMode("notes");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSessionsError(message);
      } finally {
        setSessionsBusy(false);
      }
    },
    [activeSessionId, flushSave]
  );

  const handleCreateSession = useCallback(async () => {
    const existingNames = new Set(
      sessions.map((session) => session.name.trim().toLowerCase())
    );
    let index = 1;
    let name = "Session";
    while (existingNames.has(name.toLowerCase())) {
      index += 1;
      name = `Session ${index}`;
    }

    setSessionsBusy(true);
    try {
      await flushSave();
      const snapshot = await api.createSession(name);
      setSessionsSnapshot(snapshot);
      setSessionsError(null);
      setAppMode("notes");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSessionsError(message);
    } finally {
      setSessionsBusy(false);
    }
  }, [flushSave, sessions]);

  const handleConnectGitRepo = useCallback(async () => {
    const remoteUrl = gitRemoteUrl.trim();
    const branch = gitBranch.trim();
    if (!remoteUrl) {
      setGitSyncError("Remote repository URL is required.");
      return;
    }
    setGitSyncAction("connect");
    await yieldToUi();
    try {
      const status = await api.connectGitRepo(
        remoteUrl,
        branch || undefined,
        gitUsername.trim() || undefined,
        gitPassword || undefined
      );
      setGitStatus(status);
      setGitSyncError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitSyncError(message);
    } finally {
      setGitSyncAction("idle");
    }
  }, [gitBranch, gitPassword, gitRemoteUrl, gitUsername]);

  const handleGitPull = useCallback(async () => {
    await flushSave();
    setGitSyncAction("pull");
    await yieldToUi();
    try {
      const status = await api.gitPull(
        gitBranch.trim() || undefined,
        gitUsername.trim() || undefined,
        gitPassword || undefined
      );
      setGitStatus(status);
      setGitSyncError(null);
      setLastSuccessfulSyncAt(new Date().toISOString());
      await refreshTree();
      if (layoutMode === "desktop") {
        await queueRecordingTranscriptions("auto");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitSyncError(message);
    } finally {
      setGitSyncAction("idle");
    }
  }, [
    flushSave,
    gitBranch,
    gitPassword,
    gitUsername,
    layoutMode,
    queueRecordingTranscriptions,
    refreshTree,
  ]);

  const handleGitPush = useCallback(async () => {
    await flushSave();
    setGitSyncAction("push");
    await yieldToUi();
    try {
      const statusBeforePush = await api.getGitStatus();
      setGitStatus(statusBeforePush);
      if (!statusBeforePush.push_required) {
        setGitSyncError(null);
        return;
      }
      const status = await api.gitPush(
        gitCommitMessage.trim() || undefined,
        gitBranch.trim() || undefined,
        gitUsername.trim() || undefined,
        gitPassword || undefined
      );
      setGitStatus(status);
      setGitSyncError(null);
      setLastSuccessfulSyncAt(new Date().toISOString());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitSyncError(message);
    } finally {
      setGitSyncAction("idle");
    }
  }, [flushSave, gitBranch, gitCommitMessage, gitPassword, gitUsername]);

  const shouldNestNotesInNavigation =
    appMode === "notes" && notesListMode === "nested";

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

  const visibleNavigationItems = useMemo(() => {
    if (!shouldNestNotesInNavigation) {
      return [] as VisibleNavigationItem[];
    }

    const items: VisibleNavigationItem[] = [];
    const walk = (nodes: TreeItem[], parentId: string | null) => {
      nodes.forEach((node) => {
        items.push({
          type: "folder",
          id: node.id,
          parentId,
        });
        const notesInNode = node.notes || [];
        const hasNestedItems = node.children.length > 0 || notesInNode.length > 0;
        if (!hasNestedItems || !expanded.has(node.id)) {
          return;
        }
        notesInNode.forEach((note) => {
          items.push({
            type: "note",
            id: note.path,
            parentId: node.id,
          });
        });
        walk(node.children, node.id);
      });
    };
    walk(treeData, null);
    return items;
  }, [expanded, shouldNestNotesInNavigation, treeData]);

  const parentById = useMemo(() => {
    const map: Record<string, string | null> = {};
    flatItems.forEach((item) => {
      map[item.id] = item.parentId;
    });
    return map;
  }, [flatItems]);

  const activeNode = useMemo(() => findNode(tree, activeFolder), [tree, activeFolder]);

  useEffect(() => {
    console.log("[folders] activeNode", activeNode?.path || null);
  }, [activeNode]);

  const notes = useMemo(() => activeNode?.notes || [], [activeNode]);
  const notePreviews = useNotePreviews(notes);

  // -- Create new note ------------------------------------------------------
  const createNewNote = useCallback(async (preferredFolderPath?: string, initialContent = "") => {
    if (appMode !== "notes") setAppMode("notes");
    const treeSnapshot = tree ?? (await api.getTree());
    const initialFolderPath = preferredFolderPath?.trim() || UNSORTED_FOLDER_PATH;
    const targetNode =
      findNode(treeSnapshot, initialFolderPath) || findNode(treeSnapshot, UNSORTED_FOLDER_PATH);
    if (!targetNode) return null;
    const folderPath = targetNode.path;

    const fileName = getNextNoteFileName(targetNode.notes.map((n) => n.name));
    const path = `${folderPath}/${fileName}`;

    await api.writeNote(path, initialContent);
    await api.setOrder({
      parent: folderPath,
      folderOrder: targetNode.children.map((c) => c.name),
      noteOrder: [...targetNode.notes.map((n) => n.name), fileName],
    });
    await refreshTree();

    setSelectedFolders(new Set([folderPath]));
    setLastSelectedFolder(folderPath);
    setActiveFolder(folderPath);
    setSelectedNotes(new Set([path]));
    setLastSelectedNote(path);
    setActiveNote(path);
    clearDraft();

    requestAnimationFrame(() => {
      const editorElement =
        rightPaneRef.current?.querySelector<HTMLElement>(
          ".tiptap-content[contenteditable='true']"
        ) || rightPaneRef.current;
      focusNoScroll(editorElement);
    });

    return path;
  }, [appMode, clearDraft, refreshTree, tree]);

  const enterMobileHome = useCallback(() => {
    setSelectedFolders(new Set());
    setLastSelectedFolder("");
    setActiveFolder("");
    setSelectedNotes(new Set());
    setLastSelectedNote("");
    setActiveNote(null);
    clearNote();
    clearDraft();
  }, [clearDraft, clearNote]);

  // -- App style ------------------------------------------------------------
  const appStyle = useMemo(
    () => ({ "--editor-font-size": `${editorFontSize}px` }) as CSSProperties,
    [editorFontSize]
  );

  const selectFolderForMobile = useCallback((path: string) => {
    if (!path) return;
    setSelectedFolders(new Set([path]));
    setLastSelectedFolder(path);
    setActiveFolder(path);
    setSelectedNotes(new Set());
    setLastSelectedNote("");
    setActiveNote(null);
  }, []);

  const selectNoteForMobile = useCallback(
    (notePath: string) => {
      const parentPath = getNoteParentPath(notePath);
      setSelectedFolders(new Set(parentPath ? [parentPath] : []));
      setLastSelectedFolder(parentPath);
      setActiveFolder(parentPath);
      setSelectedNotes(new Set([notePath]));
      setLastSelectedNote(notePath);
      setActiveNote(notePath);
    },
    []
  );

  // -- Folder handlers ------------------------------------------------------
  const handleFolderClick = (event: ReactMouseEvent, path: string) => {
    event.stopPropagation();
    const nextSelected = new Set(selectedFolders);
    if (event.shiftKey && lastSelectedFolder) {
      const visibleFolders = orderedIds;
      const start = visibleFolders.indexOf(lastSelectedFolder);
      const end = visibleFolders.indexOf(path);
      if (start !== -1 && end !== -1) {
        const [from, to] = start < end ? [start, end] : [end, start];
        nextSelected.clear();
        visibleFolders.slice(from, to + 1).forEach((p) => nextSelected.add(p));
      } else {
        nextSelected.clear();
        nextSelected.add(path);
      }
    } else if (event.metaKey || event.ctrlKey) {
      if (nextSelected.has(path)) nextSelected.delete(path);
      else nextSelected.add(path);
    } else {
      nextSelected.clear();
      nextSelected.add(path);
    }
    setSelectedFolders(nextSelected);
    setLastSelectedFolder(path);
    setActiveFolder(path);
    setSelectedNotes(new Set());
    setLastSelectedNote("");
    setActiveNote(null);
    focusNoScroll(foldersPanelRef.current);
  };

  const handleToggle = (event: ReactMouseEvent, id: string) => {
    event.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startRenameFolder = (path: string) => {
    if (isSystemFolder(path)) {
      window.alert(`"${path}" is a fixed folder and cannot be renamed.`);
      return;
    }
    const name = path.split("/").pop() || "";
    setRenamingFolder(path);
    setRenameValue(name);
  };

  const submitRenameFolder = async () => {
    if (!renamingFolder || !renameValue.trim()) {
      setRenamingFolder(null);
      return;
    }
    const wasSelected = selectedFolders.has(renamingFolder);
    const wasActive = activeFolder === renamingFolder;
    const newPath = await api.renameItem(renamingFolder, renameValue.trim());
    setRenamingFolder(null);
    setRenameValue("");
    await refreshTree();
    if (wasActive) setActiveFolder(newPath);
    if (wasSelected) {
      const nextSelected = new Set(selectedFolders);
      nextSelected.delete(renamingFolder);
      nextSelected.add(newPath);
      setSelectedFolders(nextSelected);
      setLastSelectedFolder(newPath);
    }
  };

  const deleteFolders = async (paths: string[]) => {
    if (paths.length === 0) return;
    if (paths.some(isSystemFolder)) {
      window.alert(
        '"Unsorted" and "Archieve" are fixed folders and cannot be deleted.'
      );
      return;
    }
    const confirmed = await confirmAction(`Delete ${paths.length} folder(s)?`);
    if (!confirmed) return;
    await api.deleteItems(paths);
    setSelectedFolders(new Set());
    if (paths.includes(activeFolder)) setActiveFolder("");
    await refreshTree();
  };

  // -- Folder context menu --------------------------------------------------
  const getFolderNativeMenu = () => {
    if (!folderMenuPromiseRef.current) {
      folderMenuPromiseRef.current = Menu.new({
        items: [
          {
            id: "folder.rename",
            text: "Rename folder",
            action: () => {
              const path = folderContextPathRef.current;
              if (path) startRenameFolder(path);
            },
          },
          {
            id: "folder.delete",
            text: "Delete folder",
            action: () => {
              const path = folderContextPathRef.current;
              if (!path) return;
              const selected = selectedFoldersRef.current;
              const paths =
                selected.size > 1 && selected.has(path)
                  ? Array.from(selected)
                  : [path];
              void deleteFolders(paths);
            },
          },
        ],
      });
    }
    return folderMenuPromiseRef.current;
  };

  const handleFolderContextMenu = async (event: ReactMouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedFolders.has(path)) {
      setSelectedFolders(new Set([path]));
      setLastSelectedFolder(path);
    }
    setActiveFolder(path);
    setSelectedNotes(new Set());
    setLastSelectedNote("");
    setActiveNote(null);
    focusNoScroll(foldersPanelRef.current);
    folderContextPathRef.current = path;
    const menu = await getFolderNativeMenu();
    await menu.popup(new LogicalPosition(event.clientX, event.clientY));
  };

  // -- Note handlers --------------------------------------------------------
  const handleNoteClick = (
    notePath: string,
    event: ReactMouseEvent,
    parentPath?: string
  ) => {
    const noteParentPath = parentPath ?? getNoteParentPath(notePath);
    const parentNode = findNode(tree, noteParentPath);
    if (!parentNode) return;
    const notePaths = parentNode.notes.map((n) => n.path);
    const nextSelected = new Set(selectedNotes);
    if (event.shiftKey && lastSelectedNote) {
      const start = notePaths.indexOf(lastSelectedNote);
      const end = notePaths.indexOf(notePath);
      if (start !== -1 && end !== -1) {
        const [from, to] = start < end ? [start, end] : [end, start];
        nextSelected.clear();
        notePaths.slice(from, to + 1).forEach((p) => nextSelected.add(p));
      } else {
        nextSelected.clear();
        nextSelected.add(notePath);
      }
    } else if (event.metaKey || event.ctrlKey) {
      if (nextSelected.has(notePath)) nextSelected.delete(notePath);
      else nextSelected.add(notePath);
    } else {
      nextSelected.clear();
      nextSelected.add(notePath);
    }
    setSelectedNotes(nextSelected);
    setLastSelectedNote(notePath);
    setSelectedFolders(new Set(noteParentPath ? [noteParentPath] : []));
    setLastSelectedFolder(noteParentPath);
    setActiveFolder(noteParentPath);
    setActiveNote(notePath);
    if (parentPath !== undefined || shouldNestNotesInNavigation) {
      focusNoScroll(foldersPanelRef.current);
    }
  };

  const deleteNotes = async (paths: string[]) => {
    if (paths.length === 0) return;
    const confirmed = await confirmAction(`Delete ${paths.length} note(s)?`);
    if (!confirmed) return;
    await api.deleteItems(paths);
    setSelectedNotes(new Set());
    setLastSelectedNote("");
    if (paths.includes(activeNote || "")) {
      setActiveNote(null);
      clearNote();
    }
    await refreshTree();
  };

  const moveNotesToArchieve = async (paths: string[]) => {
    if (paths.length === 0) return;
    await api.moveItems(paths, ARCHIEVE_FOLDER_PATH);
    setSelectedNotes(new Set());
    setLastSelectedNote("");
    setActiveNote(null);
    clearNote();
    setSelectedFolders(new Set([ARCHIEVE_FOLDER_PATH]));
    setLastSelectedFolder(ARCHIEVE_FOLDER_PATH);
    setActiveFolder(ARCHIEVE_FOLDER_PATH);
    await refreshTree();
  };

  const showNoteInfo = async (path: string) => {
    try {
      const meta = await api.getNoteMeta(path);
      const createdLabel = meta.created_ms
        ? new Date(meta.created_ms).toLocaleString()
        : "—";
      const updatedLabel = meta.updated_ms
        ? new Date(meta.updated_ms).toLocaleString()
        : "—";
      window.alert(`Created: ${createdLabel}\nUpdated: ${updatedLabel}`);
    } catch (error) {
      console.error("[notes] failed to show note info", error);
    }
  };

  const renameFolderFromMobile = useCallback(
    async (path: string, nextName: string) => {
      if (isSystemFolder(path)) {
        window.alert(`"${path}" is a fixed folder and cannot be renamed.`);
        return;
      }
      const currentName = path.split("/").pop() || "";
      const normalizedNextName = nextName.trim();
      if (!normalizedNextName || normalizedNextName === currentName) {
        return;
      }
      const wasSelected = selectedFolders.has(path);
      const wasActive = activeFolder === path;
      const newPath = await api.renameItem(path, normalizedNextName);
      await refreshTree();
      if (wasActive) {
        setActiveFolder(newPath);
      }
      if (wasSelected) {
        const nextSelected = new Set(selectedFolders);
        nextSelected.delete(path);
        nextSelected.add(newPath);
        setSelectedFolders(nextSelected);
        setLastSelectedFolder(newPath);
      }
    },
    [activeFolder, refreshTree, selectedFolders]
  );

  // -- Note context menu ----------------------------------------------------
  const getNoteNativeMenu = () => {
    if (!noteMenuPromiseRef.current) {
      noteMenuPromiseRef.current = Menu.new({
        items: [
          {
            id: "note.info",
            text: "See info",
            action: () => {
              const path = noteContextPathRef.current;
              if (path) void showNoteInfo(path);
            },
          },
          {
            id: "note.delete",
            text: "Delete selected",
            action: () => {
              const path = noteContextPathRef.current;
              if (!path) return;
              const selected = selectedNotesRef.current;
              const paths =
                selected.size > 1 && selected.has(path)
                  ? Array.from(selected)
                  : [path];
              void deleteNotes(paths);
            },
          },
          {
            id: "note.move.archieve",
            text: "Move to Archive",
            action: () => {
              const path = noteContextPathRef.current;
              if (!path) return;
              const selected = selectedNotesRef.current;
              const paths =
                selected.size > 1 && selected.has(path)
                  ? Array.from(selected)
                  : [path];
              void moveNotesToArchieve(paths);
            },
          },
        ],
      });
    }
    return noteMenuPromiseRef.current;
  };

  const handleNoteContextMenu = async (
    event: ReactMouseEvent,
    path: string,
    parentPath?: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const noteParentPath = parentPath ?? getNoteParentPath(path);
    setSelectedFolders(new Set(noteParentPath ? [noteParentPath] : []));
    setLastSelectedFolder(noteParentPath);
    setActiveFolder(noteParentPath);
    if (!selectedNotes.has(path)) {
      setSelectedNotes(new Set([path]));
      setLastSelectedNote(path);
    }
    setActiveNote(path);
    if (parentPath !== undefined || shouldNestNotesInNavigation) {
      focusNoScroll(foldersPanelRef.current);
    }
    noteContextPathRef.current = path;
    const menu = await getNoteNativeMenu();
    await menu.popup(new LogicalPosition(event.clientX, event.clientY));
  };

  // -- Drag & drop ----------------------------------------------------------
  const handleDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const data = active.data.current as DragData | undefined;
    if (!data) return;
    activeDrag.current = data;
    api.logGroup("drag start", {
      type: data.type,
      path: "path" in data ? data.path : undefined,
      id: active.id.toString(),
    });
    if (data.type === "folder") {
      const point =
        activatorEvent instanceof globalThis.MouseEvent
          ? { x: activatorEvent.clientX, y: activatorEvent.clientY }
          : null;
      dragStartPoint.current = point;
      setActiveId(active.id.toString());
      setSelectedFolders((prev) =>
        prev.has(data.path) ? prev : new Set([data.path])
      );
      setLastSelectedFolder(data.path);
      document.body.style.setProperty("cursor", "grabbing");
    }
    if (data.type === "note") {
      setSelectedNotes((prev) =>
        prev.has(data.path) ? prev : new Set([data.path])
      );
      setLastSelectedNote(data.path);
      setActiveNote(data.path);
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    if (activeDrag.current?.type !== "folder") return;
    const { active, over } = event;
    if (!active || !over) {
      setEdgeSnap(null);
      if (expandTimeoutRef.current) {
        window.clearTimeout(expandTimeoutRef.current);
        expandTimeoutRef.current = null;
      }
      expandTargetRef.current = null;
      return;
    }
    const dropTarget = parseDropTargetId(over.id);
    if (!dropTarget || dropTarget.type !== "item" || dropTarget.position !== "inside") {
      setEdgeSnap(null);
      if (expandTimeoutRef.current) {
        window.clearTimeout(expandTimeoutRef.current);
        expandTimeoutRef.current = null;
      }
      expandTargetRef.current = null;
      return;
    }

    const overNode = getNodeById(treeData, dropTarget.itemId);
    const hasChildren = Boolean(overNode?.children && overNode.children.length > 0);
    const isCollapsed = hasChildren && !expanded.has(dropTarget.itemId);
    if (isCollapsed) {
      if (expandTargetRef.current !== dropTarget.itemId) {
        if (expandTimeoutRef.current) window.clearTimeout(expandTimeoutRef.current);
        expandTargetRef.current = dropTarget.itemId;
        expandTimeoutRef.current = window.setTimeout(() => {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(dropTarget.itemId);
            return next;
          });
        }, 500);
      }
    } else if (expandTargetRef.current) {
      if (expandTimeoutRef.current) {
        window.clearTimeout(expandTimeoutRef.current);
        expandTimeoutRef.current = null;
      }
      expandTargetRef.current = null;
    }

    const overRect = over.rect;
    if (!overRect) {
      setEdgeSnap(null);
      return;
    }

    let pointerY: number | null = null;
    if (dragStartPoint.current && typeof event.delta?.y === "number") {
      pointerY = dragStartPoint.current.y + event.delta.y;
    } else {
      const activeRect = active.rect.current?.translated ?? active.rect.current?.initial;
      if (activeRect) pointerY = activeRect.top + activeRect.height / 2;
    }

    if (pointerY === null) {
      setEdgeSnap(null);
      return;
    }

    const height = overRect.bottom - overRect.top;
    const threshold = Math.min(14, height * 0.35);

    if (pointerY < overRect.top + threshold) {
      setEdgeSnap({ id: dropTarget.itemId, position: "before" });
      return;
    }
    if (pointerY > overRect.bottom - threshold) {
      if (hasChildren) {
        setEdgeSnap(null);
        return;
      }
      setEdgeSnap({ id: dropTarget.itemId, position: "after" });
      return;
    }
    setEdgeSnap(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (activeDrag.current?.type !== "folder") return;
    if (!event.over) setEdgeSnap(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    const data = active.data.current as DragData | undefined;
    const overData = over?.data.current as DragData | undefined;
    if (!data) return;

    if (data.type === "folder") {
      setActiveId(null);
      setEdgeSnap(null);
      document.body.style.setProperty("cursor", "");
      dragStartPoint.current = null;
      activeDrag.current = null;
      if (expandTimeoutRef.current) {
        window.clearTimeout(expandTimeoutRef.current);
        expandTimeoutRef.current = null;
      }
      expandTargetRef.current = null;

      if (!over) return;

      const resolvedId =
        edgeSnap ? `${DROP_PREFIX}:${edgeSnap.id}:${edgeSnap.position}` : over.id;
      const dropTarget = parseDropTargetId(resolvedId);
      if (!dropTarget) {
        api.logGroup("drop ignored", { reason: "invalid target", overId: over.id });
        return;
      }

      const selectedIdsList = Array.from(selectedFolders);
      const draggingIds = getTopLevelSelected(selectedIdsList, parentById);
      if (draggingIds.length === 0) {
        api.logGroup("drop ignored", { reason: "no dragging ids" });
        return;
      }

      if (dropTarget.type === "item" && draggingIds.includes(dropTarget.itemId)) {
        api.logGroup("drop ignored", { reason: "target is dragged item", target: dropTarget });
        return;
      }

      if (
        dropTarget.type === "item" &&
        isInDraggedSubtree(treeData, draggingIds, dropTarget.itemId)
      ) {
        api.logGroup("drop ignored", {
          reason: "target inside dragged subtree",
          target: dropTarget,
        });
        return;
      }

      const orderedDraggingIds = sortIdsByTreeOrder(draggingIds, orderedIds);
      if (orderedDraggingIds.some(isSystemFolder)) {
        api.logGroup("drop ignored", { reason: "system folder drag blocked" });
        return;
      }
      const { tree: prunedTree, removed } = removeNodes(treeData, orderedDraggingIds);
      const removedMap = new Map(removed.map((node) => [node.id, node]));
      const nodesToInsert = orderedDraggingIds
        .map((id) => removedMap.get(id))
        .filter(Boolean) as TreeItem[];

      if (nodesToInsert.length === 0) return;

      let targetParentId: string | null = null;
      let targetIndex = 0;

      if (dropTarget.type === "root") {
        targetParentId = null;
        targetIndex = prunedTree.length;
      } else if (dropTarget.position === "inside") {
        targetParentId = dropTarget.itemId;
        const parentNode = getNodeById(prunedTree, dropTarget.itemId);
        targetIndex = parentNode?.children?.length ?? 0;
      } else {
        const position = findParentAndIndex(prunedTree, dropTarget.itemId);
        if (!position) return;
        targetParentId = position.parentId;
        targetIndex = position.index + (dropTarget.position === "after" ? 1 : 0);
      }

      const nextTree = insertNodes(prunedTree, targetParentId, targetIndex, nodesToInsert);
      api.logGroup("folder drag drop", {
        dropTarget,
        draggingIds: orderedDraggingIds,
        targetParentId: targetParentId ?? "",
        targetIndex,
        selectedFolders: Array.from(selectedFolders),
      });

      const oldParentById: Record<string, string | null> = {};
      flatItems.forEach((item) => {
        oldParentById[item.id] = item.parentId;
      });
      const newParentById: Record<string, string | null> = {};
      flattenTree(nextTree).forEach((item) => {
        newParentById[item.id] = item.parentId;
      });

      for (const id of orderedDraggingIds) {
        const oldParent = oldParentById[id] ?? null;
        const newParent = newParentById[id] ?? null;
        if (oldParent !== newParent) {
          await api.moveItems([id], newParent ?? "");
        }
      }

      const noteOrderMap: Record<string, string[]> = {};
      buildNoteOrderMap(tree, noteOrderMap);

      const currentOrderMap: Record<string, string[]> = {};
      const nextOrderMap: Record<string, string[]> = {};
      buildFolderOrderMap(treeData, null, currentOrderMap);
      buildFolderOrderMap(nextTree, null, nextOrderMap);

      const changedParents = Object.keys(nextOrderMap).filter(
        (parent) => !arraysEqual(nextOrderMap[parent], currentOrderMap[parent])
      );

      api.logGroup("folder order delta", {
        changedParents,
        totalParents: Object.keys(nextOrderMap).length,
      });

      for (const parentPath of changedParents) {
        await api.setOrder({
          parent: parentPath,
          folderOrder: nextOrderMap[parentPath],
          noteOrder: noteOrderMap[parentPath] || [],
        });
      }

      if (changedParents.length > 0 && tree) {
        setTree(applyFolderOrder(tree, nextOrderMap));
      }

      if (orderedDraggingIds.some((id) => oldParentById[id] !== newParentById[id])) {
        await refreshTree();
      }
      return;
    }

    if (data.type === "note") {
      activeDrag.current = null;
      if (!over || !overData) {
        api.logGroup("note drop ignored", { reason: "missing target" });
        return;
      }
      const selectedList = selectedNotes.has(data.path)
        ? Array.from(selectedNotes)
        : [data.path];
      const sourceParentPath = getNoteParentPath(data.path);
      if (overData.type === "folder") {
        api.logGroup("note move to folder", {
          notes: selectedList,
          destination: overData.path,
        });
        await api.moveItems(selectedList, overData.path);
        if (selectedList.includes(activeNote || "")) {
          setActiveNote(null);
          clearNote();
        }
        setSelectedNotes(new Set());
        setLastSelectedNote("");
        await refreshTree();
        return;
      }
      if (overData.type === "note") {
        const destinationParentPath = getNoteParentPath(overData.path);
        if (destinationParentPath !== sourceParentPath) {
          api.logGroup("note move to note parent", {
            notes: selectedList,
            destination: destinationParentPath,
            over: overData.path,
          });
          await api.moveItems(selectedList, destinationParentPath);
          if (selectedList.includes(activeNote || "")) {
            setActiveNote(null);
            clearNote();
          }
          setSelectedNotes(new Set());
          setLastSelectedNote("");
          await refreshTree();
          return;
        }

        const parentNode = findNode(tree, destinationParentPath);
        if (!parentNode) {
          api.logGroup("note drop ignored", {
            reason: "missing destination parent",
            destinationParentPath,
          });
          return;
        }

        const movingInParent = selectedList.filter(
          (notePath) => getNoteParentPath(notePath) === destinationParentPath
        );
        const movingNotes =
          movingInParent.length > 0 ? movingInParent : [data.path];
        if (movingNotes.includes(overData.path)) return;

        const notePaths = parentNode.notes.map((n) => n.path);
        const newOrder = reorderList(notePaths, movingNotes, overData.path);
        const folderOrder = parentNode.children.map((c) => c.name);
        const noteOrder = newOrder.map((p) => p.split("/").pop() || p);
        api.logGroup("note reorder", {
          parent: parentNode.path,
          dragging: movingNotes,
          over: overData.path,
          noteOrder,
          folderOrder,
        });
        await api.setOrder({
          parent: parentNode.path,
          folderOrder,
          noteOrder,
        });
        await refreshTree();
      }
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setEdgeSnap(null);
    document.body.style.setProperty("cursor", "");
    dragStartPoint.current = null;
    activeDrag.current = null;
    if (expandTimeoutRef.current) {
      window.clearTimeout(expandTimeoutRef.current);
      expandTimeoutRef.current = null;
    }
    expandTargetRef.current = null;
  };

  // -- Keyboard navigation --------------------------------------------------
  useEffect(() => {
    if (layoutMode !== "desktop") {
      return;
    }
    const hasMiddlePane = appMode !== "notes" || !shouldNestNotesInNavigation;

    const getFocusedPane = (): PaneId | null => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (!activeElement) return null;
      if (
        foldersPanelRef.current &&
        (activeElement === foldersPanelRef.current ||
          foldersPanelRef.current.contains(activeElement))
      )
        return "folders";
      if (
        middlePaneRef.current &&
        (activeElement === middlePaneRef.current ||
          middlePaneRef.current.contains(activeElement))
      )
        return "middle";
      if (
        rightPaneRef.current &&
        (activeElement === rightPaneRef.current ||
          rightPaneRef.current.contains(activeElement))
      )
        return "right";
      return null;
    };

    const focusPane = (pane: PaneId) => {
      if (pane === "folders") {
        focusNoScroll(foldersPanelRef.current);
        return;
      }
      if (pane === "middle") {
        if (!hasMiddlePane) {
          focusNoScroll(foldersPanelRef.current);
          return;
        }
        focusNoScroll(middlePaneRef.current);
        return;
      }
      const editorElement =
        appMode === "notes"
          ? rightPaneRef.current?.querySelector<HTMLElement>(
              ".tiptap-content[contenteditable='true']"
            ) || rightPaneRef.current
          : rightPaneRef.current;
      focusNoScroll(editorElement);
    };

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.repeat) return;
      const code = event.code;
      if (
        code !== "KeyT" &&
        code !== "KeyW" &&
        code !== "KeyK" &&
        code !== "KeyJ" &&
        code !== "KeyN" &&
        code !== "Equal" &&
        code !== "Minus" &&
        code !== "Digit0" &&
        code !== "NumpadAdd" &&
        code !== "NumpadSubtract" &&
        code !== "Numpad0"
      )
        return;
      event.preventDefault();

      if (code === "Equal" || code === "NumpadAdd") {
        if (appMode === "notes") setEditorFontSize((prev) => Math.min(28, prev + 1));
        return;
      }
      if (code === "Minus" || code === "NumpadSubtract") {
        if (appMode === "notes") setEditorFontSize((prev) => Math.max(12, prev - 1));
        return;
      }
      if (code === "Digit0" || code === "Numpad0") {
        if (appMode === "notes") setEditorFontSize(14);
        return;
      }
      if (code === "KeyN") {
        void createNewNote();
        return;
      }
      if (code === "KeyT") {
        const currentPane = getFocusedPane();
        setSidebarCollapsed((prev) => {
          const next = !prev;
          if (next) {
            if (currentPane === "folders" || currentPane === "middle")
              lastLeftPaneFocusRef.current = currentPane;
            requestAnimationFrame(() => focusPane("right"));
          } else {
            requestAnimationFrame(() => focusPane(lastLeftPaneFocusRef.current));
          }
          return next;
        });
        return;
      }
      if (code === "KeyW") {
        if (sidebarCollapsed) {
          setSidebarCollapsed(false);
          requestAnimationFrame(() =>
            focusPane(hasMiddlePane ? lastLeftPaneFocusRef.current : "folders")
          );
          return;
        }
        if (!hasMiddlePane) {
          lastLeftPaneFocusRef.current = "folders";
          focusPane("folders");
          return;
        }
        const currentPane = getFocusedPane();
        const targetPane: "folders" | "middle" =
          currentPane === "folders" ? "middle" : "folders";
        lastLeftPaneFocusRef.current = targetPane;
        focusPane(targetPane);
        return;
      }

      const panes: PaneId[] = sidebarCollapsed
        ? ["right"]
        : hasMiddlePane
          ? ["folders", "middle", "right"]
          : ["folders", "right"];
      const currentPane = getFocusedPane();
      const startPane =
        currentPane && panes.includes(currentPane)
          ? currentPane
          : hasMiddlePane
            ? "middle"
            : "folders";
      const delta = code === "KeyK" ? 1 : -1;
      const nextIndex = Math.max(
        0,
        Math.min(panes.length - 1, panes.indexOf(startPane) + delta)
      );
      const targetPane = panes[nextIndex];
      if (targetPane === "folders" || targetPane === "middle")
        lastLeftPaneFocusRef.current = targetPane;
      focusPane(targetPane);
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [appMode, createNewNote, layoutMode, shouldNestNotesInNavigation, sidebarCollapsed]);

  const handleNotesKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      if ((event.metaKey || event.ctrlKey) && event.key === "ArrowLeft") {
        event.preventDefault();
        lastLeftPaneFocusRef.current = "folders";
        focusNoScroll(foldersPanelRef.current);
      }
      return;
    }
    if (!activeNode || notes.length === 0) return;
    event.preventDefault();
    const notePaths = notes.map((n) => n.path);
    const current =
      lastSelectedNote && notePaths.includes(lastSelectedNote)
        ? lastSelectedNote
        : activeNote || notePaths[0];
    const currentIndex = notePaths.indexOf(current);
    const delta = event.key === "ArrowUp" ? -1 : 1;
    const nextIndex = Math.max(0, Math.min(notePaths.length - 1, currentIndex + delta));
    const nextPath = notePaths[nextIndex];
    setSelectedNotes(new Set([nextPath]));
    setLastSelectedNote(nextPath);
    setActiveNote(nextPath);
    requestAnimationFrame(() => {
      scrollIntoViewIfNeeded(
        notesPanelRef.current,
        `[data-note="${escapeSelectorValue(nextPath)}"]`
      );
    });
  };

  const handleFoldersKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "ArrowRight") {
      event.preventDefault();
      if (appMode === "notes" && shouldNestNotesInNavigation) {
        const editorElement =
          rightPaneRef.current?.querySelector<HTMLElement>(
            ".tiptap-content[contenteditable='true']"
          ) || rightPaneRef.current;
        focusNoScroll(editorElement);
      } else {
        lastLeftPaneFocusRef.current = "middle";
        focusNoScroll(middlePaneRef.current);
      }
      return;
    }
    if (
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight"
    )
      return;
    if (shouldNestNotesInNavigation) {
      if (visibleNavigationItems.length === 0) return;
      event.preventDefault();

      const navIds = visibleNavigationItems.map((item) => item.id);
      const current =
        lastSelectedNote && navIds.includes(lastSelectedNote)
          ? lastSelectedNote
          : lastSelectedFolder && navIds.includes(lastSelectedFolder)
            ? lastSelectedFolder
            : activeNote && navIds.includes(activeNote)
              ? activeNote
              : activeFolder && navIds.includes(activeFolder)
                ? activeFolder
                : navIds[0];
      const currentIndex = navIds.indexOf(current);
      const currentEntry = visibleNavigationItems[currentIndex];
      if (!currentEntry) return;

      const selectFolder = (folderPath: string) => {
        setSelectedFolders(new Set([folderPath]));
        setLastSelectedFolder(folderPath);
        setActiveFolder(folderPath);
        setSelectedNotes(new Set());
        setLastSelectedNote("");
        setActiveNote(null);
        focusNoScroll(foldersPanelRef.current);
        requestAnimationFrame(() => {
          scrollIntoViewIfNeeded(
            foldersPanelRef.current,
            `[data-folder="${escapeSelectorValue(folderPath)}"]`
          );
        });
      };

      const selectNote = (notePath: string, parentPath: string) => {
        setSelectedFolders(new Set(parentPath ? [parentPath] : []));
        setLastSelectedFolder(parentPath);
        setActiveFolder(parentPath);
        setSelectedNotes(new Set([notePath]));
        setLastSelectedNote(notePath);
        setActiveNote(notePath);
        focusNoScroll(foldersPanelRef.current);
        requestAnimationFrame(() => {
          scrollIntoViewIfNeeded(
            foldersPanelRef.current,
            `[data-note="${escapeSelectorValue(notePath)}"]`
          );
        });
      };

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const delta = event.key === "ArrowUp" ? -1 : 1;
        const nextIndex = Math.max(
          0,
          Math.min(visibleNavigationItems.length - 1, currentIndex + delta)
        );
        const nextEntry = visibleNavigationItems[nextIndex];
        if (!nextEntry) return;
        if (nextEntry.type === "folder") {
          selectFolder(nextEntry.id);
          return;
        }
        selectNote(nextEntry.id, nextEntry.parentId);
        return;
      }

      if (event.key === "ArrowRight") {
        if (currentEntry.type !== "folder") return;
        const folderItem = flatItemById.get(currentEntry.id);
        const noteCount = folderItem?.notes?.length || 0;
        const childCount = folderItem?.children.length || 0;
        const hasNestedItems = childCount > 0 || noteCount > 0;
        if (!hasNestedItems) return;
        if (!expanded.has(currentEntry.id)) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(currentEntry.id);
            return next;
          });
          return;
        }
        const firstChildEntry = visibleNavigationItems[currentIndex + 1];
        if (!firstChildEntry || firstChildEntry.parentId !== currentEntry.id) return;
        if (firstChildEntry.type === "folder") {
          selectFolder(firstChildEntry.id);
          return;
        }
        selectNote(firstChildEntry.id, firstChildEntry.parentId);
        return;
      }

      if (event.key === "ArrowLeft") {
        if (currentEntry.type === "note") {
          selectFolder(currentEntry.parentId);
          return;
        }

        const folderItem = flatItemById.get(currentEntry.id);
        const noteCount = folderItem?.notes?.length || 0;
        const childCount = folderItem?.children.length || 0;
        const hasNestedItems = childCount > 0 || noteCount > 0;
        if (hasNestedItems && expanded.has(currentEntry.id)) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.delete(currentEntry.id);
            return next;
          });
          return;
        }
        const parentFolderId = currentEntry.parentId;
        if (!parentFolderId) return;
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(parentFolderId);
          return next;
        });
        selectFolder(parentFolderId);
      }
      return;
    }

    if (visibleItems.length === 0) return;
    event.preventDefault();

    const current =
      lastSelectedFolder && orderedIds.includes(lastSelectedFolder)
        ? lastSelectedFolder
        : activeFolder || orderedIds[0];
    const currentIndex = orderedIds.indexOf(current);
    const currentItem = flatItems.find((item) => item.id === current);
    const parentId = currentItem?.parentId ?? null;
    const hasChildren = currentItem ? currentItem.children.length > 0 : false;
    const isExpanded = current ? expanded.has(current) : false;

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const delta = event.key === "ArrowUp" ? -1 : 1;
      const nextIndex = Math.max(
        0,
        Math.min(orderedIds.length - 1, currentIndex + delta)
      );
      const nextPath = orderedIds[nextIndex];
      setSelectedFolders(new Set([nextPath]));
      setLastSelectedFolder(nextPath);
      setActiveFolder(nextPath);
      setSelectedNotes(new Set());
      setLastSelectedNote("");
      setActiveNote(null);
      requestAnimationFrame(() => {
        scrollIntoViewIfNeeded(
          foldersPanelRef.current,
          `[data-folder="${escapeSelectorValue(nextPath)}"]`
        );
      });
      return;
    }

    if (event.key === "ArrowRight") {
      if (currentItem && hasChildren) {
        if (!isExpanded) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(currentItem.id);
            return next;
          });
          return;
        }
        const firstChild = currentItem.children[0];
        if (firstChild) {
          setSelectedFolders(new Set([firstChild.id]));
          setLastSelectedFolder(firstChild.id);
          setActiveFolder(firstChild.id);
          setSelectedNotes(new Set());
          setLastSelectedNote("");
          setActiveNote(null);
          requestAnimationFrame(() => {
            scrollIntoViewIfNeeded(
              foldersPanelRef.current,
              `[data-folder="${escapeSelectorValue(firstChild.id)}"]`
            );
          });
        }
      }
      return;
    }

    if (event.key === "ArrowLeft") {
      if (currentItem && hasChildren && isExpanded) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(currentItem.id);
          return next;
        });
        return;
      }
      if (parentId) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(parentId);
          return next;
        });
        setSelectedFolders(new Set([parentId]));
        setLastSelectedFolder(parentId);
        setActiveFolder(parentId);
        setSelectedNotes(new Set());
        setLastSelectedNote("");
        setActiveNote(null);
        requestAnimationFrame(() => {
          scrollIntoViewIfNeeded(
            foldersPanelRef.current,
            `[data-folder="${escapeSelectorValue(parentId)}"]`
          );
        });
      }
    }
  };

  const activeFolderTitle = activeNode?.name || activeFolder || "Notes";
  const activeNoteTitle =
    (activeNote ? notePreviews[activeNote]?.title : null) ||
    (activeNote ? activeNote.split("/").pop()?.replace(/\.md$/i, "") : null) ||
    "Note";

  // -- Render helpers -------------------------------------------------------
  const renderMiddlePane = () =>
    appMode === "notes" ? (
      <div className="pane notes-pane min-w-0">
        <div className="pane-drag-region" data-tauri-drag-region aria-hidden />
        <div
          className="pane-body focus:outline-none"
          ref={(node) => {
            notesPanelRef.current = node;
            middlePaneRef.current = node;
          }}
          tabIndex={0}
          onKeyDown={handleNotesKeyDown}
          onClick={() => {
            lastLeftPaneFocusRef.current = "middle";
            focusNoScroll(middlePaneRef.current);
          }}
        >
          {notes.length === 0 && <div className="empty">No notes</div>}
          <SortableContext
            items={notes.map((n) => n.path)}
            strategy={verticalListSortingStrategy}
          >
            {notes.map((note) => (
              <NoteRow
                key={note.path}
                note={note}
                preview={notePreviews[note.path]}
                isSelected={selectedNotes.has(note.path)}
                onClick={handleNoteClick}
                onContextMenu={handleNoteContextMenu}
              />
            ))}
          </SortableContext>
        </div>
      </div>
    ) : (
      <SettingsMiddlePane
        activeSection={activeSettingsSection}
        onSectionChange={setActiveSettingsSection}
        middlePaneRef={middlePaneRef}
        onPaneClick={() => {
          lastLeftPaneFocusRef.current = "middle";
          focusNoScroll(middlePaneRef.current);
        }}
      />
    );

  const renderRightPane = () =>
    appMode === "notes" ? (
      <div className="pane editor-pane min-w-0">
        <div
          className="pane-body editor-body"
          ref={rightPaneRef}
          tabIndex={0}
          onClick={() => {
            const editorElement =
              rightPaneRef.current?.querySelector<HTMLElement>(
                ".tiptap-content[contenteditable='true']"
              ) || rightPaneRef.current;
            focusNoScroll(editorElement);
          }}
        >
          <div className="editor-single">
            <NoteEditor
              markdown={activeNote ? noteContent : draftNoteContent}
              onChange={handleEditorChange}
            />
          </div>
        </div>
      </div>
    ) : (
      <SettingsDetailPane
        activeSection={activeSettingsSection}
        theme={theme}
        onThemeChange={setTheme}
        notesListMode={notesListMode}
        onNotesListModeChange={setNotesListMode}
        sessions={sessions}
        activeSessionId={activeSessionId}
        sessionBusy={sessionsBusy}
        sessionError={sessionsError}
        onSessionChange={(sessionId) => {
          void handleSwitchSession(sessionId);
        }}
        onCreateSession={() => {
          void handleCreateSession();
        }}
        gitRemoteUrl={gitRemoteUrl}
        onGitRemoteUrlChange={setGitRemoteUrl}
        gitBranch={gitBranch}
        onGitBranchChange={setGitBranch}
        gitUsername={gitUsername}
        onGitUsernameChange={setGitUsername}
        gitPassword={gitPassword}
        onGitPasswordChange={setGitPassword}
        gitCommitMessage={gitCommitMessage}
        onGitCommitMessageChange={setGitCommitMessage}
        gitStatus={gitStatus}
        gitSyncBusy={gitSyncBusy}
        gitSyncAction={gitSyncAction}
        gitSyncError={gitSyncError}
        onGitRefresh={() => void refreshGitStatus()}
        onGitConnect={() => void handleConnectGitRepo()}
        onGitPull={() => void handleGitPull()}
        onGitPush={() => void handleGitPush()}
        assemblyAiApiKey={assemblyAiApiKey}
        onAssemblyAiApiKeyChange={setAssemblyAiApiKey}
        recordingSupported={recordingSupported}
        isRecordingAudio={isRecordingAudio}
        isRecordingBusy={isRecordingFinalizing || transcriptionQueueBusy}
        recordingError={recorderError}
        recordingStatus={recordingStatusMessage}
        recordingLiveStatus={recordingLiveStatus}
        recordingsQueue={recordingsQueue}
        recordings={recordingsList}
        recordingsBusy={recordingsBusy}
        recordingsError={recordingsError}
        activeAudioPath={activeAudioPath}
        activeAudioSrc={activeAudioSrc}
        onRefreshRecordings={() => {
          void refreshRecordings();
        }}
        onPlayRecording={(audioPath) => {
          void playRecording(audioPath);
        }}
        onStartAudioRecording={() => {
          void startRecording();
        }}
        onStopAudioRecording={stopRecording}
        onQueueRecordings={() => {
          void queueRecordingTranscriptions("manual");
        }}
        rightPaneRef={rightPaneRef}
        onPaneClick={() => focusNoScroll(rightPaneRef.current)}
      />
    );

  const renderLeftPane = () => (
    <div className="pane-with-drag">
      <div className="pane-drag-region" data-tauri-drag-region aria-hidden />
      <FoldersPanel
        treeData={treeData}
        selectedIds={selectedFolders}
        onSelect={handleFolderClick}
        edgeSnap={edgeSnap}
        expanded={expanded}
        onToggle={handleToggle}
        showNotesAsChildren={shouldNestNotesInNavigation}
        selectedNoteIds={selectedNotes}
        onNoteSelect={handleNoteClick}
        onNoteContextMenu={handleNoteContextMenu}
        onPaneKeyDown={handleFoldersKeyDown}
        onPaneClick={() => {
          lastLeftPaneFocusRef.current = "folders";
          focusNoScroll(foldersPanelRef.current);
        }}
        paneBodyRef={foldersPanelRef}
        onClearSelection={() => {
          setSelectedFolders(new Set());
          setLastSelectedFolder("");
          setSelectedNotes(new Set());
          setLastSelectedNote("");
          if (shouldNestNotesInNavigation) {
            setActiveNote(null);
          }
        }}
        renamingFolder={renamingFolder}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        submitRenameFolder={submitRenameFolder}
        cancelRenameFolder={() => {
          setRenamingFolder(null);
          setRenameValue("");
        }}
        onContextMenu={handleFolderContextMenu}
        indentationWidth={indentationWidth}
        sectionTitle="Folders"
        topAction={
          <div className="nav-action-group">
            <button
              type="button"
              className="nav-action nav-action-new rounded-xl px-3 py-2 transition-colors"
              onClick={(event) => {
                event.stopPropagation();
                void createNewNote();
              }}
            >
              <span className="nav-action-icon" aria-hidden>
                +
              </span>
              <span>New note</span>
            </button>
            <button
              type="button"
              className={`nav-action nav-action-record rounded-xl px-3 py-2 transition-colors${
                isRecordingAudio ? " active" : ""
              }`}
              onClick={(event) => {
                event.stopPropagation();
                if (isRecordingAudio) {
                  stopRecording();
                } else {
                  void startRecording(activeFolder || undefined);
                }
              }}
              disabled={!recordingSupported || isRecordingFinalizing}
            >
              <span className="nav-action-icon" aria-hidden>
                {isRecordingAudio ? "■" : "●"}
              </span>
              <span>{isRecordingAudio ? "Stop recording" : "Record audio"}</span>
            </button>
          </div>
        }
        footer={
          <button
            type="button"
            className={`nav-action nav-action-settings rounded-xl px-3 py-2 transition-colors${
              appMode === "settings" ? " active" : ""
            }`}
            onClick={(event) => {
              event.stopPropagation();
              setAppMode((prev) => (prev === "notes" ? "settings" : "notes"));
            }}
          >
            <span className="nav-action-icon text-base leading-none" aria-hidden>
              {appMode === "settings" ? (
                "←"
              ) : (
                <Settings className="h-4 w-4 shrink-0" strokeWidth={1.9} />
              )}
            </span>
            <span>{appMode === "settings" ? "Back to notes" : "Settings"}</span>
          </button>
        }
      />
    </div>
  );

  const dndSensors = layoutMode === "desktop" ? sensors : [];
  const gitSyncBusy = gitSyncAction !== "idle";
  const lastSuccessfulSyncLabel = lastSuccessfulSyncAt
    ? new Date(lastSuccessfulSyncAt).toLocaleString()
    : null;

  // -- Main render ----------------------------------------------------------
  return (
    <DndContext
      sensors={dndSensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className={`window-shell theme-${theme}`}>
        {layoutMode === "desktop" ? (
          <DesktopShell
            theme={theme}
            appStyle={appStyle}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)}
            shouldNestNotesInNavigation={shouldNestNotesInNavigation}
            twoPaneLayout={twoPaneLayout}
            setTwoPaneLayout={setTwoPaneLayout}
            threePaneLayout={threePaneLayout}
            setThreePaneLayout={setThreePaneLayout}
            leftPane={renderLeftPane()}
            middlePane={renderMiddlePane()}
            rightPane={renderRightPane()}
          />
        ) : (
          <MobileShell
            layoutMode={layoutMode}
            theme={theme}
            appStyle={appStyle}
            visibleFolders={visibleItems}
            expanded={expanded}
            onToggleFolder={(path) =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(path)) next.delete(path);
                else next.add(path);
                return next;
              })
            }
            activeFolder={activeFolder}
            activeFolderTitle={activeFolderTitle}
            onSelectFolder={selectFolderForMobile}
            onRenameFolder={renameFolderFromMobile}
            onDeleteFolder={async (path) => {
              await deleteFolders([path]);
            }}
            notes={notes}
            notePreviews={notePreviews}
            activeNote={activeNote}
            activeNoteTitle={activeNoteTitle}
            onSelectNote={selectNoteForMobile}
            onCreateNote={createNewNote}
            onEnterHome={enterMobileHome}
            onDeleteNote={async (path) => {
              await deleteNotes([path]);
            }}
            onArchiveNote={async (path) => {
              await moveNotesToArchieve([path]);
            }}
            onShowNoteInfo={showNoteInfo}
            onNoteContextMenu={handleNoteContextMenu}
            editorMarkdown={activeNote ? noteContent : draftNoteContent}
            onEditorChange={handleEditorChange}
            hasActiveNote={Boolean(activeNote)}
            isSaving={isNoteSaving}
            saveError={noteSaveError}
            onRetrySave={retrySave}
            flushSave={flushSave}
            keyboardInset={keyboardInset}
            settingsSections={MOBILE_SETTINGS_SECTIONS}
            activeSettingsSection={activeSettingsSection}
            onSettingsSectionChange={setActiveSettingsSection}
            notesListMode={notesListMode}
            onNotesListModeChange={setNotesListMode}
            onThemeChange={setTheme}
            sessions={sessions}
            activeSessionId={activeSessionId}
            sessionBusy={sessionsBusy}
            sessionError={sessionsError}
            onSessionChange={(sessionId) => {
              void handleSwitchSession(sessionId);
            }}
            onCreateSession={() => {
              void handleCreateSession();
            }}
            gitRemoteUrl={gitRemoteUrl}
            onGitRemoteUrlChange={setGitRemoteUrl}
            gitBranch={gitBranch}
            onGitBranchChange={setGitBranch}
            gitUsername={gitUsername}
            onGitUsernameChange={setGitUsername}
            gitPassword={gitPassword}
            onGitPasswordChange={setGitPassword}
            gitCommitMessage={gitCommitMessage}
            onGitCommitMessageChange={setGitCommitMessage}
            gitStatus={gitStatus}
            gitSyncBusy={gitSyncBusy}
            gitSyncAction={gitSyncAction}
            gitSyncError={gitSyncError}
            onGitRefresh={() => void refreshGitStatus()}
            onGitConnect={() => void handleConnectGitRepo()}
            onGitPull={() => void handleGitPull()}
            onGitPush={() => void handleGitPush()}
            lastSuccessfulSyncAt={lastSuccessfulSyncLabel}
            assemblyAiApiKey={assemblyAiApiKey}
            onAssemblyAiApiKeyChange={setAssemblyAiApiKey}
            recordingSupported={recordingSupported}
            isRecordingAudio={isRecordingAudio}
            isRecordingBusy={isRecordingFinalizing || transcriptionQueueBusy}
            recordingError={recorderError}
            recordingStatus={recordingStatusMessage}
            recordingLiveStatus={recordingLiveStatus}
            recordingsQueue={recordingsQueue}
            recordings={recordingsList}
            recordingsBusy={recordingsBusy}
            recordingsError={recordingsError}
            activeAudioPath={activeAudioPath}
            activeAudioSrc={activeAudioSrc}
            onRefreshTree={async () => {
              await refreshTree();
            }}
            onRefreshRecordings={() => {
              void refreshRecordings();
            }}
            onPlayRecording={(audioPath) => {
              void playRecording(audioPath);
            }}
            onStartAudioRecording={(folderPath) => {
              void startRecording(folderPath);
            }}
            onStopAudioRecording={stopRecording}
            onQueueRecordings={() => {
              void queueRecordingTranscriptions("manual");
            }}
          />
        )}
      </div>
      <DragOverlay modifiers={[snapCenterToCursor]}>
        {layoutMode === "desktop" && activeId ? (
          <div className="drag-ghost">{activeId.split("/").pop() || activeId}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default App;
