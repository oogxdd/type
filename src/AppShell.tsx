import {
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
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu } from "@tauri-apps/api/menu";
import { Settings } from "lucide-react";

import { useTheme } from "./contexts/ThemeContext";
import { useNotesTree } from "./contexts/NotesTreeContext";
import { useRecordings } from "./contexts/RecordingsContext";
import { useGitSync } from "./contexts/GitSyncContext";
import { useSessions } from "./contexts/SessionsContext";

import { useDragDrop } from "./hooks/useDragDrop";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";

import { FoldersPanel } from "./components/FoldersPanel";
import { NoteRow } from "./components/NoteRow";
import { NoteEditor } from "./components/NoteEditor";
import {
  SettingsMiddlePane,
  SettingsDetailPane,
  type SettingsSectionId,
} from "./components/SettingsPanel";
import { DesktopShell } from "./desktop/DesktopShell";
import { MobileShell } from "./mobile/MobileShell";
import { useLayoutMode } from "./mobile/useLayoutMode";
import { useKeyboardInsets } from "./mobile/useKeyboardInsets";

import { focusNoScroll } from "./utils/dom";
import { getNoteParentPath } from "./utils/notes";
import { indentationWidth, MOBILE_SETTINGS_SECTIONS } from "./constants";
import type { AppMode } from "./types";

export function AppShell() {
  const layoutMode = useLayoutMode();
  const { keyboardInset } = useKeyboardInsets();

  // -- Contexts
  const {
    theme,
    editorFontSize,
    notesListMode,
    setNotesListMode,
    setTheme,
    increaseEditorFontSize,
    decreaseEditorFontSize,
    resetEditorFontSize,
  } = useTheme();

  const {
    sessions,
    activeSessionId,
    sessionsBusy,
    sessionsError,
    switchSession,
    createSession,
    syncSettings,
    updateSyncSettings,
  } = useSessions();

  const {
    gitStatus,
    gitSyncAction,
    gitSyncError,
    gitSyncBusy,
    gitSyncHistory,
    refreshGitStatus,
    connectGitRepo,
    gitPull,
    gitPush,
  } = useGitSync();

  const {
    recordingSupported,
    isRecordingAudio,
    isRecordingFinalizing,
    recorderError,
    recordingStatusMessage,
    recordingLiveStatus,
    transcriptionQueueBusy,
    recordingsQueue,
    recordingsList,
    recordingsBusy,
    recordingsError,
    activeAudioPath,
    activeAudioSrc,
    startRecording,
    stopRecording,
    refreshRecordings,
    playRecording,
    queueRecordingTranscriptions,
  } = useRecordings();

  const notesTree = useNotesTree();
  const {
    tree,
    setTree,
    treeData,
    flatItems,
    visibleItems,
    orderedIds,
    flatItemById,
    expanded,
    setExpanded,
    selectedFolders,
    setSelectedFolders,
    lastSelectedFolder,
    setLastSelectedFolder,
    activeFolder,
    setActiveFolder,
    selectedNotes,
    setSelectedNotes,
    lastSelectedNote,
    setLastSelectedNote,
    activeNote,
    setActiveNote,
    notes,
    allNotes,
    notePreviews,
    allNotePreviews,
    activeNode,
    visibleNavigationItems,
    parentById,
    renamingFolder,
    renameValue,
    setRenameValue,
    submitRenameFolder,
    cancelRenameFolder,
    startRenameFolder,
    noteContent,
    draftNoteContent,
    isNoteSaving,
    noteSaveError,
    handleEditorChange,
    clearNote,
    flushSave,
    retrySave,
    refreshTree,
    createNewNote,
    deleteNotes,
    deleteFolders,
    moveNotesToArchive,
    showNoteInfo,
    selectFolderForMobile,
    selectNoteForMobile,
    enterMobileHome,
    renameFolderFromMobile,
    shouldNestNotesInNavigation,
    rightPaneRef,
  } = notesTree;

  // -- Local UI state
  const [appMode, setAppMode] = useState<AppMode>("notes");
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>("general");
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

  // -- Refs
  const notesPanelRef = useRef<HTMLDivElement | null>(null);
  const foldersPanelRef = useRef<HTMLDivElement | null>(null);
  const middlePaneRef = useRef<HTMLDivElement | null>(null);
  const folderContextPathRef = useRef<string | null>(null);
  const noteContextPathRef = useRef<string | null>(null);
  const selectedFoldersRef = useRef<Set<string>>(new Set());
  const selectedNotesRef = useRef<Set<string>>(new Set());
  const folderMenuPromiseRef = useRef<Promise<Menu> | null>(null);
  const noteMenuPromiseRef = useRef<Promise<Menu> | null>(null);

  // -- Sync refs
  selectedFoldersRef.current = selectedFolders;
  selectedNotesRef.current = selectedNotes;

  // -- Drag-drop
  const {
    activeId,
    edgeSnap,
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useDragDrop({
    tree,
    setTree,
    treeData,
    flatItems,
    orderedIds,
    expanded,
    setExpanded,
    selectedFolders,
    setSelectedFolders,
    setLastSelectedFolder,
    selectedNotes,
    setSelectedNotes,
    setLastSelectedNote,
    setActiveNote,
    activeNote,
    clearNote,
    refreshTree,
    parentById,
  });

  // -- Keyboard navigation
  const { handleNotesKeyDown, handleFoldersKeyDown, lastLeftPaneFocusRef } = useKeyboardNavigation({
    layoutMode,
    appMode,
    shouldNestNotesInNavigation,
    sidebarCollapsed,
    editorFontSize,
    increaseEditorFontSize,
    decreaseEditorFontSize,
    resetEditorFontSize,
    createNewNote: () => createNewNote(),
    setSidebarCollapsed,
    visibleItems,
    orderedIds,
    flatItemById,
    expanded,
    setExpanded,
    visibleNavigationItems,
    activeFolder,
    lastSelectedFolder,
    setSelectedFolders,
    setLastSelectedFolder,
    setActiveFolder,
    activeNote,
    lastSelectedNote,
    setSelectedNotes,
    setLastSelectedNote,
    setActiveNote,
    notes,
    activeNode,
    foldersPanelRef,
    middlePaneRef,
    rightPaneRef,
    notesPanelRef,
  });

  // -- Sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // -- Folder handlers
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

  // -- Folder context menu
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

  // -- Note handlers
  const handleNoteClick = (
    notePath: string,
    event: ReactMouseEvent,
    parentPath?: string
  ) => {
    const noteParentPath = parentPath ?? getNoteParentPath(notePath);
    const parentNode = tree ? findNodeInTree(tree, noteParentPath) : null;
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

  // -- Note context menu
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
              void moveNotesToArchive(paths);
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

  // -- Derived
  const activeFolderTitle = activeNode?.name || activeFolder || "Notes";
  const activeNoteTitle =
    (activeNote ? notePreviews[activeNote]?.title : null) ||
    (activeNote ? activeNote.split("/").pop()?.replace(/\.md$/i, "") : null) ||
    "Note";

  const appStyle = useMemo(
    () => ({ "--editor-font-size": `${editorFontSize}px` }) as CSSProperties,
    [editorFontSize]
  );

  const dndSensors = layoutMode === "desktop" ? sensors : [];
  const lastSuccessfulSyncLabel = syncSettings.lastSuccessfulSyncAt
    ? new Date(syncSettings.lastSuccessfulSyncAt).toLocaleString()
    : null;

  // -- Render helpers
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
          void switchSession(sessionId);
        }}
        onCreateSession={() => {
          void createSession();
        }}
        gitRemoteUrl={syncSettings.gitRemoteUrl}
        onGitRemoteUrlChange={(v) => updateSyncSettings({ gitRemoteUrl: v })}
        gitBranch={syncSettings.gitBranch}
        onGitBranchChange={(v) => updateSyncSettings({ gitBranch: v })}
        gitUsername={syncSettings.gitUsername}
        onGitUsernameChange={(v) => updateSyncSettings({ gitUsername: v })}
        gitPassword={syncSettings.gitPassword}
        onGitPasswordChange={(v) => updateSyncSettings({ gitPassword: v })}
        gitCommitMessage={syncSettings.gitCommitMessage}
        onGitCommitMessageChange={(v) => updateSyncSettings({ gitCommitMessage: v })}
        gitStatus={gitStatus}
        gitSyncBusy={gitSyncBusy}
        gitSyncAction={gitSyncAction}
        gitSyncError={gitSyncError}
        onGitRefresh={() => void refreshGitStatus()}
        onGitConnect={() => void connectGitRepo()}
        onGitPull={() => void gitPull({ onAfterPull: () => refreshTree() })}
        onGitPush={() => void gitPush()}
        assemblyAiApiKey={syncSettings.assemblyAiApiKey}
        onAssemblyAiApiKeyChange={(v) => updateSyncSettings({ assemblyAiApiKey: v })}
        mobileAutoTranscriptionEnabled={syncSettings.mobileAutoTranscriptionEnabled}
        onMobileAutoTranscriptionChange={(v) =>
          updateSyncSettings({ mobileAutoTranscriptionEnabled: v })
        }
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
        cancelRenameFolder={cancelRenameFolder}
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

  // -- Main render
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
            allNotes={allNotes}
            allNotePreviews={allNotePreviews}
            activeNote={activeNote}
            activeNoteTitle={activeNoteTitle}
            onSelectNote={selectNoteForMobile}
            onCreateNote={createNewNote}
            onEnterHome={enterMobileHome}
            onDeleteNote={async (path) => {
              return deleteNotes([path]);
            }}
            onArchiveNote={async (path) => {
              await moveNotesToArchive([path]);
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
              void switchSession(sessionId);
            }}
            onCreateSession={() => {
              void createSession();
            }}
            gitRemoteUrl={syncSettings.gitRemoteUrl}
            onGitRemoteUrlChange={(v) => updateSyncSettings({ gitRemoteUrl: v })}
            gitBranch={syncSettings.gitBranch}
            onGitBranchChange={(v) => updateSyncSettings({ gitBranch: v })}
            gitUsername={syncSettings.gitUsername}
            onGitUsernameChange={(v) => updateSyncSettings({ gitUsername: v })}
            gitPassword={syncSettings.gitPassword}
            onGitPasswordChange={(v) => updateSyncSettings({ gitPassword: v })}
            gitCommitMessage={syncSettings.gitCommitMessage}
            onGitCommitMessageChange={(v) => updateSyncSettings({ gitCommitMessage: v })}
            gitStatus={gitStatus}
            gitSyncBusy={gitSyncBusy}
            gitSyncAction={gitSyncAction}
            gitSyncError={gitSyncError}
            gitSyncHistory={gitSyncHistory}
            onGitRefresh={() => void refreshGitStatus()}
            onGitConnect={() => void connectGitRepo()}
            onGitPull={() => void gitPull({ onAfterPull: () => refreshTree() })}
            onGitPush={() => void gitPush()}
            lastSuccessfulSyncAt={lastSuccessfulSyncLabel}
            assemblyAiApiKey={syncSettings.assemblyAiApiKey}
            onAssemblyAiApiKeyChange={(v) => updateSyncSettings({ assemblyAiApiKey: v })}
            mobileAutoTranscriptionEnabled={syncSettings.mobileAutoTranscriptionEnabled}
            onMobileAutoTranscriptionChange={(v) =>
              updateSyncSettings({ mobileAutoTranscriptionEnabled: v })
            }
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

// Helper needed for note click handler
function findNodeInTree(node: import("./types").FolderNode, path: string): import("./types").FolderNode | null {
  if (node.path === path) return node;
  for (const child of node.children) {
    const found = findNodeInTree(child, path);
    if (found) return found;
  }
  return null;
}
