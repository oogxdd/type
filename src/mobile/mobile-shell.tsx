import { Mic } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useShallow } from "zustand/react/shallow";
import type { SettingsSectionId } from "@/features/settings/lib/sections";
import type { MobileToastState } from "./navigation";
import { MobileActionSheet } from "@/mobile/ui/action-sheet";
import { MobileNavBar } from "@/mobile/ui/nav-bar";
import { MobilePromptSheet } from "@/mobile/ui/prompt-sheet";
import { MobileToast } from "@/mobile/ui/toast";

import { useAppearance } from "@/app/state/appearance-store";
import { useSelection } from "@/app/state/selection-store";
import { useEditor } from "@/features/editor/hooks/editor-context";
import { useNotesTree } from "@/features/notes/hooks/notes-tree-context";
import { useGitSync } from "@/features/sync/hooks/git-sync-context";
import { parseSyncDeepLink } from "@/features/sync/api/local-sync-link";
import { useLayoutMode } from "@/mobile/use-layout-mode";
import { useKeyboardInsets } from "@/mobile/use-keyboard-insets";
import { useEdgeSwipe } from "@/mobile/hooks/use-edge-swipe";

import { useMobileNavigation } from "@/mobile/hooks/use-mobile-navigation";
import { useActionSheets } from "@/mobile/hooks/use-action-sheets";
import { usePhoneNavHeader } from "@/mobile/hooks/use-phone-nav-header";
import { useRecentBuckets } from "@/mobile/hooks/use-recent-buckets";
import { PhoneRouteRenderer } from "@/mobile/screens";
import { TabletLayout } from "@/mobile/tablet-layout";
import { FEED_FOLDER_PATH, getDisplayFolderName, ARCHIVE_FOLDER_PATH } from "./types";
import { MobileNavigationDrawer } from "@/mobile/navigation-drawer";

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
  const { theme, editorFontSize } = useAppearance(
    useShallow((state) => ({
      theme: state.theme,
      editorFontSize: state.editorFontSize,
    }))
  );
  const {
    activeFolder,
    activeNote,
    selectFolderForMobile,
    selectNoteForMobile,
    enterMobileHome,
  } = useSelection(
    useShallow((state) => ({
      activeFolder: state.activeFolder,
      activeNote: state.activeNote,
      selectFolderForMobile: state.selectFolderForMobile,
      selectNoteForMobile: state.selectNoteForMobile,
      enterMobileHome: state.enterMobileHome,
    }))
  );
  const { clearNote, clearDraft } = useEditor();
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
  const { syncNow } = useGitSync();

  const appStyle = useMemo(
    () => ({ "--editor-font-size": `${editorFontSize}px` }) as CSSProperties,
    [editorFontSize]
  );
  const activeFolderTitle = activeNode?.name || activeFolder || "Notes";
  const activeNoteTitle =
    (activeNote ? notePreviews[activeNote]?.title || allNotePreviews[activeNote]?.title : null) ||
    "Note";

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

  // -- Deep link listener (record shortcut + type2://sync from a desktop QR)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const handleUrls = (urls: string[]) => {
      for (const url of urls) {
        const sync = parseSyncDeepLink(url);
        if (sync) {
          void syncNow({
            remote: sync.remote,
            branch: sync.branch,
            onAfterPull: () => refreshTree(),
          });
          break;
        }
        if (url.includes("record")) {
          openRecordingRoute(FEED_FOLDER_PATH, true);
          break;
        }
      }
    };
    import("@tauri-apps/plugin-deep-link")
      .then(async (mod) => {
        unlisten = await mod.onOpenUrl(handleUrls);
        // Catch a cold-start launch URL (app opened by the deep link).
        try {
          const current = await mod.getCurrent();
          if (current && current.length > 0) {
            handleUrls(current);
          }
        } catch {
          // getCurrent unsupported on some platforms — ignore.
        }
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [openRecordingRoute, syncNow, refreshTree]);

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
            <MobileNavigationDrawer
              navigationTab={navigationTabState}
              onNavigationTabChange={setNavigationTab}
              folders={navigationFolders}
              activeFolder={activeFolder}
              expanded={expanded}
              onToggleFolder={onToggleFolder}
              onSelectFolder={(folderPath) => {
                openNotesRoute(folderPath);
                setFoldersDrawerOpen(false);
              }}
              onFolderLongPress={openFolderActionSheet}
              recentBuckets={recentBuckets.map((bucket) => ({
                id: bucket.id,
                label: bucket.label,
                subtitle: bucket.subtitle,
                count: bucket.notes.length,
              }))}
              onSelectRecentBucket={(bucketId) => {
                openRecentBucketRoute(bucketId);
                setFoldersDrawerOpen(false);
              }}
              onOpenArchive={() => {
                openArchiveRoute();
                setFoldersDrawerOpen(false);
              }}
              onClose={() => setFoldersDrawerOpen(false)}
            />
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
