import {
  Archive,
  Clock3,
  Folder,
  Mic,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { SettingsSectionId } from "../components/SettingsPanel";
import type { MobileToastState } from "./navigation";
import { MobileActionSheet } from "./components/MobileActionSheet";
import { MobileNavBar } from "./components/MobileNavBar";
import { MobilePromptSheet } from "./components/MobilePromptSheet";
import { MobileToast } from "./components/MobileToast";

import { useTheme } from "../contexts/ThemeContext";
import { useSelection } from "../contexts/SelectionContext";
import { useEditor } from "../contexts/EditorContext";
import { useNotesTree } from "../contexts/NotesTreeContext";
import { useLayoutMode } from "./useLayoutMode";
import { useKeyboardInsets } from "./useKeyboardInsets";
import { useEdgeSwipe } from "../hooks/useEdgeSwipe";

import { useMobileNavigation } from "./hooks/useMobileNavigation";
import { useActionSheets } from "./hooks/useActionSheets";
import { usePhoneNavHeader } from "./hooks/usePhoneNavHeader";
import { useRecentBuckets } from "./hooks/useRecentBuckets";
import { PhoneRouteRenderer } from "./screens";
import { TabletLayout } from "./TabletLayout";
import { FEED_FOLDER_PATH, getDisplayFolderName, ARCHIVE_FOLDER_PATH } from "./types";
import { MobileFoldersScreen } from "./components/MobileFoldersScreen";
import { MobileRecentScreen } from "./components/MobileRecentScreen";

type MobileShellProps = {
  activeSettingsSection: SettingsSectionId;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
  onNoteContextMenu: (
    event: ReactMouseEvent,
    notePath: string,
    parentPath?: string
  ) => Promise<void>;
};

export function MobileShell({
  activeSettingsSection,
  onSettingsSectionChange,
  onNoteContextMenu,
}: MobileShellProps) {
  const layoutMode = useLayoutMode();
  const { keyboardInset } = useKeyboardInsets();
  const { theme, editorFontSize } = useTheme();
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
    handleEditorChange,
    clearNote,
    clearDraft,
  } = useEditor();
  const {
    visibleItems,
    expanded,
    notes,
    notePreviews,
    allNotePreviews,
    activeNode,
    refreshTree,
    createNewNote,
  } = useNotesTree();

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

  // -- Navigation
  const {
    dispatch,
    currentRoute,
    phoneTransitionDirection,
    nextTransitionRef,
    popRoute,
    openNotesRoute,
    openArchiveRoute,
    openRecentBucketRoute,
    openEditorRoute,
    openRecordingRoute,
  } = useMobileNavigation(layoutMode);

  // -- Toast
  const [toast, setToast] = useState<MobileToastState | null>(null);
  const showToast = useCallback((message: string, tone: MobileToastState["tone"] = "info") => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  // -- Action sheets
  const {
    sheetState,
    renamePrompt,
    setRenamePrompt,
    closeActionSheet,
    openFolderActionSheet,
    openNoteActionSheet,
    onDeleteNote,
    onArchiveNote,
    onToggleFolder,
    onSheetSelect,
    onRenameConfirm,
  } = useActionSheets(showToast);

  // -- Recent buckets
  const { recentBuckets, recentBucketById } = useRecentBuckets();

  // -- Local UI state
  const [tabletLeftMode, setTabletLeftMode] = useState<"folders" | "settings">("folders");
  const [foldersDrawerOpen, setFoldersDrawerOpen] = useState(false);
  const [navigationTabState, setNavigationTab] = useState<"folders" | "recent">("folders");

  // -- Phone nav header
  const { phoneTitle, phoneLeftAction, phoneRightActions } = usePhoneNavHeader({
    currentRoute,
    navigationTab: navigationTabState,
    activeFolderTitle,
    activeNoteTitle,
    recentBucketById,
    dispatch,
    popRoute,
    openEditorRoute,
    openRecordingRoute,
    createNewNote,
    setFoldersDrawerOpen,
  });

  // -- Edge swipe back
  const edgeSwipeEnabled = layoutMode === "phone" && !foldersDrawerOpen;
  const edgeSwipeHandlers = useEdgeSwipe(edgeSwipeEnabled, () => {
    void popRoute();
  });

  // -- Navigation folders (filter archive/hidden)
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

  const refreshNotesFeed = useCallback(
    async (_folderPath: string) => {
      await refreshTree();
    },
    [refreshTree]
  );

  // -- Sync route → selection (phone only)
  useEffect(() => {
    if (layoutMode !== "phone") return;
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

  // -- Layout reset
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
  }, [layoutMode, dispatch]);

  // -- Home enter (clear selection on home)
  const onEnterHome = useCallback(() => {
    enterMobileHome();
    clearNote();
    clearDraft();
  }, [enterMobileHome, clearNote, clearDraft]);

  useEffect(() => {
    if (layoutMode !== "phone" || currentRoute.kind !== "home") return;
    onEnterHome();
  }, [currentRoute.kind, layoutMode, onEnterHome]);

  // -- Escape to close drawer
  useEffect(() => {
    if (!foldersDrawerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFoldersDrawerOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [foldersDrawerOpen]);

  // -- Deep link listener
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/plugin-deep-link")
      .then(({ onOpenUrl }) =>
        onOpenUrl((urls: string[]) => {
          for (const url of urls) {
            if (url.includes("record")) {
              openRecordingRoute(FEED_FOLDER_PATH, true);
              break;
            }
          }
        })
      )
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [openRecordingRoute]);

  // -- Route key for animation
  const routeKey =
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
                : `settings:${currentRoute.section || "root"}`;

  return (
    <div
      className={`mobile-root theme-${theme}`}
      data-layout={layoutMode}
      style={appStyle}
      {...edgeSwipeHandlers}
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
              key={routeKey}
              className={`mobile-screen-stage ${phoneTransitionDirection}`}
            >
              <PhoneRouteRenderer
                currentRoute={currentRoute}
                editorMarkdown={editorMarkdown}
                handleEditorChange={handleEditorChange}
                keyboardInset={keyboardInset}
                createNewNote={createNewNote}
                openEditorRoute={openEditorRoute}
                nextTransitionRef={nextTransitionRef}
                dispatch={dispatch}
                navigationTab={navigationTabState}
                navigationFolders={navigationFolders}
                activeFolder={activeFolder}
                expanded={expanded}
                onToggleFolder={onToggleFolder}
                openNotesRoute={(folderPath) => {
                  openNotesRoute(folderPath);
                  setFoldersDrawerOpen(false);
                }}
                openFolderActionSheet={openFolderActionSheet}
                recentBuckets={recentBuckets}
                openRecentBucketRoute={(bucketId) => {
                  openRecentBucketRoute(bucketId);
                  setFoldersDrawerOpen(false);
                }}
                activeFolderTitle={activeFolderTitle}
                notes={notes}
                notePreviews={notePreviews}
                activeNote={activeNote}
                showToast={showToast}
                onDeleteNote={onDeleteNote}
                onArchiveNote={onArchiveNote}
                openNoteActionSheet={openNoteActionSheet}
                onNoteContextMenu={onNoteContextMenu}
                refreshNotesFeed={refreshNotesFeed}
                allNotePreviews={allNotePreviews}
                recentBucketById={recentBucketById}
                refreshTree={refreshTree}
                activeSettingsSection={activeSettingsSection}
                onSettingsSectionChange={onSettingsSectionChange}
              />
            </div>
          </main>
          {currentRoute.kind === "home" ? (
            <button
              type="button"
              className="mobile-home-mic-fab"
              aria-label="Start recording"
              onClick={() => openRecordingRoute()}
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
                      className={`mobile-drawer-tab${navigationTabState === "folders" ? " active" : ""}`}
                      onClick={() => setNavigationTab("folders")}
                    >
                      <Folder size={15} />
                      <span>Folders</span>
                    </button>
                    <button
                      type="button"
                      className={`mobile-drawer-tab${navigationTabState === "recent" ? " active" : ""}`}
                      onClick={() => setNavigationTab("recent")}
                    >
                      <Clock3 size={15} />
                      <span>Recent</span>
                    </button>
                  </div>
                  <div className="mobile-drawer-main">
                    {navigationTabState === "folders" ? (
                      <MobileFoldersScreen
                        items={navigationFolders}
                        activeFolder={activeFolder}
                        expanded={expanded}
                        onToggle={onToggleFolder}
                        onSelect={(folderPath) => {
                          openNotesRoute(folderPath);
                          setFoldersDrawerOpen(false);
                        }}
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
                        onSelect={(bucketId) => {
                          openRecentBucketRoute(bucketId);
                          setFoldersDrawerOpen(false);
                        }}
                      />
                    )}
                  </div>
                  <div className="mobile-drawer-footer">
                    <button
                      type="button"
                      className="mobile-drawer-archive-btn"
                      onClick={() => {
                        openArchiveRoute();
                        setFoldersDrawerOpen(false);
                      }}
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
        <TabletLayout
          tabletLeftMode={tabletLeftMode}
          setTabletLeftMode={setTabletLeftMode}
          activeSettingsSection={activeSettingsSection}
          onSettingsSectionChange={onSettingsSectionChange}
          showToast={showToast}
          onNoteContextMenu={onNoteContextMenu}
          navigationFolders={navigationFolders}
          onToggleFolder={onToggleFolder}
          openFolderActionSheet={openFolderActionSheet}
          onDeleteNote={onDeleteNote}
          onArchiveNote={onArchiveNote}
          openNoteActionSheet={openNoteActionSheet}
          refreshNotesFeed={refreshNotesFeed}
        />
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
        onConfirm={onRenameConfirm}
      />
      <MobileToast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
