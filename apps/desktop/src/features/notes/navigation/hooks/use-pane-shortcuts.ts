import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AppMode, PaneId } from "@typenotes/shared/types";
import { useAppearance } from "@/app/state/appearance-store";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { paneShortcutFor } from "@/features/notes/navigation/model/pane-shortcuts";
import { focusNoScroll } from "@/shared/lib/dom";

type UsePaneShortcutsArgs = {
  appMode: AppMode;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  moveSelectedNotesToTrash: () => void;
  deleteSelectedNotes: () => void;
  lockAppNow: () => Promise<void>;
  foldersPanelRef: React.RefObject<HTMLDivElement | null>;
  middlePaneRef: React.RefObject<HTMLDivElement | null>;
  lastLeftPaneFocusRef: React.MutableRefObject<"folders" | "middle">;
};

/**
 * Desktop global keyboard shortcuts and pane focus management:
 * cmd/ctrl + T (toggle sidebar), W (toggle navigation/editor), J (cycle all panes),
 * N (new note), Backspace (move to trash), shift+Backspace (delete), +/-/0
 * (editor font size), shift+L (lock). `model/pane-shortcuts` is the whole list —
 * this listener captures and stops propagation, so a chord it claims is taken
 * away from the command palette and the editor.
 * Tracks the last-focused left pane so toggling the sidebar can restore it.
 */
export function usePaneShortcuts({
  appMode,
  sidebarCollapsed,
  setSidebarCollapsed,
  moveSelectedNotesToTrash,
  deleteSelectedNotes,
  lockAppNow,
  foldersPanelRef,
  middlePaneRef,
  lastLeftPaneFocusRef,
}: UsePaneShortcutsArgs) {
  const { rightPaneRef } = useEditor();
  const { createNewNote, shouldNestNotesInNavigation } = useNotesTree();
  const { increaseEditorFontSize, decreaseEditorFontSize, resetEditorFontSize } =
    useAppearance(
      useShallow((state) => ({
        increaseEditorFontSize: state.increaseEditorFontSize,
        decreaseEditorFontSize: state.decreaseEditorFontSize,
        resetEditorFontSize: state.resetEditorFontSize,
      }))
    );

  useEffect(() => {
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
        const settingsSection =
          appMode === "settings"
            ? middlePaneRef.current?.querySelector<HTMLElement>(
                ".settings-nav-row.is-selected"
              )
            : null;
        focusNoScroll(settingsSection || middlePaneRef.current);
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
      const shortcut = paneShortcutFor(event.code, { shiftKey: event.shiftKey });
      if (!shortcut) return;
      event.preventDefault();
      // Capture pane shortcuts before contenteditable/Tiptap key handlers. On
      // macOS, Control+T and Control+W otherwise reach the editor first and
      // behave differently from their Command-key equivalents.
      event.stopPropagation();

      if (shortcut === "font-size-up") {
        if (appMode === "notes") increaseEditorFontSize();
        return;
      }
      if (shortcut === "font-size-down") {
        if (appMode === "notes") decreaseEditorFontSize();
        return;
      }
      if (shortcut === "font-size-reset") {
        if (appMode === "notes") resetEditorFontSize();
        return;
      }
      if (shortcut === "new-note") {
        void createNewNote();
        return;
      }
      if (shortcut === "lock-app") {
        void lockAppNow();
        return;
      }
      if (shortcut === "delete-selection" || shortcut === "trash-selection") {
        if (appMode === "notes") {
          if (shortcut === "delete-selection") deleteSelectedNotes();
          else moveSelectedNotesToTrash();
        }
        return;
      }
      if (shortcut === "toggle-sidebar") {
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
      if (shortcut === "toggle-navigation-focus") {
        const navigationPane: "folders" | "middle" =
          appMode === "settings" ? "middle" : "folders";
        if (sidebarCollapsed && navigationPane === "folders") {
          setSidebarCollapsed(false);
          lastLeftPaneFocusRef.current = navigationPane;
          requestAnimationFrame(() => focusPane(navigationPane));
          return;
        }
        const currentPane = getFocusedPane();
        if (currentPane === "right") {
          lastLeftPaneFocusRef.current = navigationPane;
          focusPane(navigationPane);
        } else {
          focusPane("right");
        }
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
      // "cycle-panes" is one key, so it has to be able to visit every pane:
      // it wraps instead of clamping at the ends.
      const currentIndex = panes.indexOf(startPane);
      const nextIndex = (currentIndex + 1) % panes.length;
      const targetPane = panes[nextIndex];
      if (targetPane === "folders" || targetPane === "middle")
        lastLeftPaneFocusRef.current = targetPane;
      focusPane(targetPane);
    };

    window.addEventListener("keydown", handleGlobalKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleGlobalKeyDown, { capture: true });
  }, [
    appMode,
    createNewNote,
    deleteSelectedNotes,
    moveSelectedNotesToTrash,
    decreaseEditorFontSize,
    foldersPanelRef,
    increaseEditorFontSize,
    middlePaneRef,
    resetEditorFontSize,
    rightPaneRef,
    lockAppNow,
    setSidebarCollapsed,
    shouldNestNotesInNavigation,
    sidebarCollapsed,
    lastLeftPaneFocusRef,
  ]);
}
