import {
  ChevronLeft,
  Folder,
  Plus,
  RefreshCw,
  Settings,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { SettingsSectionId, ThemeMode, NotesListMode } from "../components/SettingsPanel";
import type { FlattenedItem } from "../tree/types";
import type { GitSyncStatus, NoteEntry } from "../types";
import type { NotePreview } from "../utils/format";
import {
  getCurrentRoute,
  getInitialMobileNavigationState,
  mobileNavigationReducer,
  type LayoutMode,
  type MobileActionSheetState,
  type MobileToastState,
} from "./navigation";
import { MobileActionSheet } from "./components/MobileActionSheet";
import { MobileEditorScreen } from "./components/MobileEditorScreen";
import { MobileFoldersScreen } from "./components/MobileFoldersScreen";
import { MobileNavBar } from "./components/MobileNavBar";
import { MobileNotesScreen } from "./components/MobileNotesScreen";
import { MobileSettingsScreen } from "./components/MobileSettingsScreen";
import { MobileTabBar } from "./components/MobileTabBar";
import { MobileToast } from "./components/MobileToast";
import { MobilePromptSheet } from "./components/MobilePromptSheet";

type MobileShellProps = {
  layoutMode: Exclude<LayoutMode, "desktop">;
  theme: ThemeMode;
  appStyle: CSSProperties;
  visibleFolders: FlattenedItem[];
  expanded: Set<string>;
  onToggleFolder: (folderPath: string) => void;
  activeFolder: string;
  activeFolderTitle: string;
  onSelectFolder: (folderPath: string) => void;
  onRenameFolder: (folderPath: string, nextName: string) => Promise<void>;
  onDeleteFolder: (folderPath: string) => Promise<void>;
  notes: NoteEntry[];
  notePreviews: Record<string, NotePreview>;
  activeNote: string | null;
  activeNoteTitle: string;
  onSelectNote: (notePath: string) => void;
  onCreateNote: (folderPath?: string) => Promise<string | null>;
  onDeleteNote: (notePath: string) => Promise<void>;
  onArchiveNote: (notePath: string) => Promise<void>;
  onShowNoteInfo: (notePath: string) => Promise<void>;
  onRefreshAll: () => Promise<void>;
  editorMarkdown: string;
  onEditorChange: (markdown: string) => void;
  hasActiveNote: boolean;
  isSaving: boolean;
  saveError: string | null;
  onRetrySave: () => Promise<void>;
  flushSave: () => Promise<void>;
  keyboardInset: number;
  settingsSections: Array<{ id: SettingsSectionId; label: string }>;
  activeSettingsSection: SettingsSectionId;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
  notesListMode: NotesListMode;
  onNotesListModeChange: (mode: NotesListMode) => void;
  onThemeChange: (theme: ThemeMode) => void;
  gitRemoteUrl: string;
  onGitRemoteUrlChange: (value: string) => void;
  gitBranch: string;
  onGitBranchChange: (value: string) => void;
  gitUsername: string;
  onGitUsernameChange: (value: string) => void;
  gitPassword: string;
  onGitPasswordChange: (value: string) => void;
  gitCommitMessage: string;
  onGitCommitMessageChange: (value: string) => void;
  gitStatus: GitSyncStatus | null;
  gitSyncBusy: boolean;
  gitSyncError: string | null;
  onGitRefresh: () => void;
  onGitConnect: () => void;
  onGitPull: () => void;
  onGitPush: () => void;
  lastSuccessfulSyncAt: string | null;
  assemblyAiApiKey: string;
  onAssemblyAiApiKeyChange: (value: string) => void;
  recordingSupported: boolean;
  isRecordingAudio: boolean;
  isRecordingBusy: boolean;
  recordingError: string | null;
  recordingStatus: string | null;
  onStartAudioRecording: () => void;
  onStopAudioRecording: () => void;
  onQueueRecordings: () => void;
};

type SheetContext =
  | { type: "folder"; path: string }
  | { type: "note"; path: string };

const TABLET_LEFT_ITEMS = [
  { id: "folders", label: "Folders", icon: <Folder size={16} /> },
  { id: "settings", label: "Settings", icon: <Settings size={16} /> },
] as const;
const SYSTEM_FOLDER_PATHS = new Set(["Unsorted", "Archieve", "Recordings"]);

const getDisplayFolderName = (rawName: string) =>
  rawName === "Archieve" ? "Archive" : rawName;
const getDisplayRouteTitle = (rawTitle: string) =>
  rawTitle === "Archieve" ? "Archive" : rawTitle;

export function MobileShell({
  layoutMode,
  theme,
  appStyle,
  visibleFolders,
  expanded,
  onToggleFolder,
  activeFolder,
  activeFolderTitle,
  onSelectFolder,
  onRenameFolder,
  onDeleteFolder,
  notes,
  notePreviews,
  activeNote,
  activeNoteTitle,
  onSelectNote,
  onCreateNote,
  onDeleteNote,
  onArchiveNote,
  onShowNoteInfo,
  onRefreshAll,
  editorMarkdown,
  onEditorChange,
  hasActiveNote,
  isSaving,
  saveError,
  onRetrySave,
  flushSave,
  keyboardInset,
  settingsSections,
  activeSettingsSection,
  onSettingsSectionChange,
  notesListMode,
  onNotesListModeChange,
  onThemeChange,
  gitRemoteUrl,
  onGitRemoteUrlChange,
  gitBranch,
  onGitBranchChange,
  gitUsername,
  onGitUsernameChange,
  gitPassword,
  onGitPasswordChange,
  gitCommitMessage,
  onGitCommitMessageChange,
  gitStatus,
  gitSyncBusy,
  gitSyncError,
  onGitRefresh,
  onGitConnect,
  onGitPull,
  onGitPush,
  lastSuccessfulSyncAt,
  assemblyAiApiKey,
  onAssemblyAiApiKeyChange,
  recordingSupported,
  isRecordingAudio,
  isRecordingBusy,
  recordingError,
  recordingStatus,
  onStartAudioRecording,
  onStopAudioRecording,
  onQueueRecordings,
}: MobileShellProps) {
  const [navigationState, dispatch] = useReducer(
    mobileNavigationReducer,
    getInitialMobileNavigationState()
  );
  const [tabletLeftMode, setTabletLeftMode] = useState<"folders" | "settings">("folders");
  const [sheetState, setSheetState] = useState<MobileActionSheetState | null>(null);
  const [sheetContext, setSheetContext] = useState<SheetContext | null>(null);
  const [toast, setToast] = useState<MobileToastState | null>(null);
  const [renamePrompt, setRenamePrompt] = useState<{ path: string; currentName: string } | null>(
    null
  );
  const previousStackDepthRef = useRef(navigationState.stack.length);
  const [phoneTransitionDirection, setPhoneTransitionDirection] = useState<"forward" | "backward">(
    "forward"
  );

  const edgeSwipeStart = useRef<{ x: number; y: number } | null>(null);
  const edgeSwipeTriggered = useRef(false);

  const currentRoute = getCurrentRoute(navigationState);

  useEffect(() => {
    if (layoutMode !== "phone") {
      return;
    }
    const previousDepth = previousStackDepthRef.current;
    const nextDepth = navigationState.stack.length;
    if (nextDepth > previousDepth) {
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
    if (currentRoute.kind === "notes" || currentRoute.kind === "editor") {
      if (currentRoute.folderPath && currentRoute.folderPath !== activeFolder) {
        onSelectFolder(currentRoute.folderPath);
      }
    }
    if (currentRoute.kind === "editor" && currentRoute.notePath !== activeNote) {
      onSelectNote(currentRoute.notePath);
    }
  }, [activeFolder, activeNote, currentRoute, layoutMode, onSelectFolder, onSelectNote]);

  useEffect(() => {
    if (layoutMode === "tablet") {
      dispatch({ type: "reset", route: { kind: "folders" } });
    }
  }, [layoutMode]);

  const showToast = useCallback((message: string, tone: MobileToastState["tone"] = "info") => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  const closeActionSheet = useCallback(() => {
    setSheetState(null);
    setSheetContext(null);
  }, []);

  const popRoute = useCallback(async () => {
    if (layoutMode !== "phone") {
      return;
    }
    if (currentRoute.kind === "editor") {
      await flushSave();
    }
    dispatch({ type: "pop" });
  }, [currentRoute.kind, flushSave, layoutMode]);

  const handleEdgeSwipeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (layoutMode !== "phone") {
        return;
      }
      if (event.clientX > 24) {
        edgeSwipeStart.current = null;
        return;
      }
      edgeSwipeTriggered.current = false;
      edgeSwipeStart.current = { x: event.clientX, y: event.clientY };
    },
    [layoutMode]
  );

  const handleEdgeSwipeMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (layoutMode !== "phone") {
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
    [layoutMode, popRoute]
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
          await onShowNoteInfo(context.path);
          return;
        }
        if (actionId === "note.archive") {
          await onArchiveNote(context.path);
          showToast("Moved to Archive", "success");
          return;
        }
        if (actionId === "note.delete") {
          await onDeleteNote(context.path);
          showToast("Note deleted", "success");
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
      onShowNoteInfo,
      sheetContext,
      showToast,
    ]
  );

  const settingsScreen = (
    <MobileSettingsScreen
      activeSection={activeSettingsSection}
      onSectionChange={onSettingsSectionChange}
      sections={settingsSections}
      theme={theme}
      onThemeChange={onThemeChange}
      notesListMode={notesListMode}
      onNotesListModeChange={onNotesListModeChange}
      gitRemoteUrl={gitRemoteUrl}
      onGitRemoteUrlChange={onGitRemoteUrlChange}
      gitBranch={gitBranch}
      onGitBranchChange={onGitBranchChange}
      gitUsername={gitUsername}
      onGitUsernameChange={onGitUsernameChange}
      gitPassword={gitPassword}
      onGitPasswordChange={onGitPasswordChange}
      gitCommitMessage={gitCommitMessage}
      onGitCommitMessageChange={onGitCommitMessageChange}
      gitStatus={gitStatus}
      gitSyncBusy={gitSyncBusy}
      gitSyncError={gitSyncError}
      onGitRefresh={onGitRefresh}
      onGitConnect={onGitConnect}
      onGitPull={onGitPull}
      onGitPush={onGitPush}
      lastSuccessfulSyncAt={lastSuccessfulSyncAt}
      assemblyAiApiKey={assemblyAiApiKey}
      onAssemblyAiApiKeyChange={onAssemblyAiApiKeyChange}
      recordingSupported={recordingSupported}
      isRecordingAudio={isRecordingAudio}
      isRecordingBusy={isRecordingBusy}
      recordingError={recordingError}
      recordingStatus={recordingStatus}
      onStartAudioRecording={onStartAudioRecording}
      onStopAudioRecording={onStopAudioRecording}
      onQueueRecordings={onQueueRecordings}
    />
  );

  const phoneContent = useMemo(() => {
    if (currentRoute.kind === "folders") {
      return (
        <MobileFoldersScreen
          items={visibleFolders}
          activeFolder={activeFolder}
          expanded={expanded}
          onToggle={onToggleFolder}
          onSelect={(path) => {
            onSelectFolder(path);
            dispatch({ type: "push", route: { kind: "notes", folderPath: path } });
          }}
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
            onSelectNote(path);
            dispatch({
              type: "push",
              route: {
                kind: "editor",
                folderPath: currentRoute.folderPath,
                notePath: path,
              },
            });
          }}
          onCreate={() => {
            void (async () => {
              const path = await onCreateNote(currentRoute.folderPath);
              if (!path) {
                return;
              }
              dispatch({
                type: "push",
                route: {
                  kind: "editor",
                  folderPath: currentRoute.folderPath,
                  notePath: path,
                },
              });
            })();
          }}
          onDelete={(path) => {
            void (async () => {
              try {
                await onDeleteNote(path);
                showToast("Note deleted", "success");
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
          onRefresh={onRefreshAll}
        />
      );
    }

    if (currentRoute.kind === "editor") {
      return (
        <MobileEditorScreen
          markdown={editorMarkdown}
          onChange={onEditorChange}
          hasActiveNote={hasActiveNote}
          isSaving={isSaving}
          saveError={saveError}
          keyboardInset={keyboardInset}
          onRetrySave={() => {
            void onRetrySave();
          }}
        />
      );
    }

    return settingsScreen;
  }, [
    activeFolder,
    activeFolderTitle,
    activeNote,
    currentRoute,
    editorMarkdown,
    expanded,
    hasActiveNote,
    isSaving,
    keyboardInset,
    notePreviews,
    notes,
    onArchiveNote,
    onCreateNote,
    onDeleteNote,
    onEditorChange,
    onRefreshAll,
    onRetrySave,
    onSelectFolder,
    onSelectNote,
    onToggleFolder,
    openFolderActionSheet,
    openNoteActionSheet,
    saveError,
    settingsScreen,
    showToast,
    visibleFolders,
  ]);

  const phoneTitle =
    currentRoute.kind === "folders"
      ? "Folders"
      : currentRoute.kind === "notes"
        ? getDisplayRouteTitle(activeFolderTitle)
        : currentRoute.kind === "editor"
          ? activeNoteTitle
          : "Settings";

  const phoneLeftAction =
    currentRoute.kind === "folders"
      ? undefined
      : {
          label: "Back",
          icon: <ChevronLeft size={18} />,
          onPress: () => {
            void popRoute();
          },
        };

  const phoneRightAction =
    currentRoute.kind === "folders"
      ? {
          label: "Settings",
          icon: <Settings size={18} />,
          onPress: () => dispatch({ type: "push", route: { kind: "settings" } }),
        }
      : currentRoute.kind === "notes"
        ? {
            label: "New note",
            icon: <Plus size={18} />,
            onPress: () => {
              void (async () => {
                const path = await onCreateNote(currentRoute.folderPath);
                if (!path) {
                  return;
                }
                dispatch({
                  type: "push",
                  route: { kind: "editor", folderPath: currentRoute.folderPath, notePath: path },
                });
              })();
            },
          }
        : currentRoute.kind === "editor"
          ? {
              label: "Refresh",
              icon: <RefreshCw size={17} />,
              onPress: () => {
                void onRefreshAll();
              },
            }
          : undefined;

  const tabletFoldersPane = (
    tabletLeftMode === "folders" ? (
      <div className="mobile-tablet-left-content">
        <MobileFoldersScreen
          items={visibleFolders}
          activeFolder={activeFolder}
          expanded={expanded}
          onToggle={onToggleFolder}
          onSelect={onSelectFolder}
          onLongPress={openFolderActionSheet}
        />
      </div>
    ) : (
      <div className="mobile-tablet-settings-sections" role="tablist" aria-label="Settings sections">
        {settingsSections.map((section) => (
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
      settingsScreen
    ) : (
      <div className="mobile-tablet-right-split">
        <div className="mobile-tablet-notes-pane">
          <MobileNotesScreen
            folderTitle={activeFolderTitle}
            notes={notes}
            previews={notePreviews}
            activeNote={activeNote}
            onSelect={onSelectNote}
            onCreate={() => {
              void onCreateNote(activeFolder);
            }}
            onDelete={(path) => {
              void (async () => {
                try {
                  await onDeleteNote(path);
                  showToast("Note deleted", "success");
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
            onRefresh={onRefreshAll}
          />
        </div>
        <div className="mobile-tablet-editor-pane">
          <MobileEditorScreen
            markdown={editorMarkdown}
            onChange={onEditorChange}
            hasActiveNote={hasActiveNote}
            isSaving={isSaving}
            saveError={saveError}
            keyboardInset={keyboardInset}
            onRetrySave={() => {
              void onRetrySave();
            }}
          />
        </div>
      </div>
    );

  return (
    <div
      className={`mobile-root theme-${theme}`}
      style={appStyle}
      onPointerDown={handleEdgeSwipeStart}
      onPointerMove={handleEdgeSwipeMove}
      onPointerUp={handleEdgeSwipeEnd}
      onPointerCancel={handleEdgeSwipeEnd}
    >
      {layoutMode === "phone" ? (
        <>
          <MobileNavBar title={phoneTitle} leftAction={phoneLeftAction} rightAction={phoneRightAction} />
          <main className="mobile-screen">
            <div
              key={
                currentRoute.kind === "folders"
                  ? "folders"
                  : currentRoute.kind === "notes"
                    ? `notes:${currentRoute.folderPath}`
                    : currentRoute.kind === "editor"
                      ? `editor:${currentRoute.notePath}`
                      : `settings:${currentRoute.section || "root"}`
              }
              className={`mobile-screen-stage ${phoneTransitionDirection === "forward" ? "forward" : "backward"}`}
            >
              {phoneContent}
            </div>
          </main>
        </>
      ) : (
        <div className="mobile-tablet-shell">
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
          <section className="mobile-tablet-right">{tabletRightContent}</section>
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
            await onRenameFolder(renamePrompt.path, nextName);
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
