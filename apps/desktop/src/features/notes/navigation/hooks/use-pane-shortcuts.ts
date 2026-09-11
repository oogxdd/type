import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AppMode, PaneId } from "@typenotes/shared/types";
import { useAppearance } from "@/app/state/appearance-store";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { useGlobalShortcut } from "@/shared/keyboard/use-global-shortcuts";
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
 * The pane half of the global keymap: collapsing the sidebar, moving focus
 * between panes, creating and removing notes, editor font size, and the lock.
 * Which keystroke reaches which of these is decided in
 * `shared/keyboard/keymap.ts`; this hook only implements the behavior and
 * tracks the last-focused left pane so toggling the sidebar can restore it.
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

  const hasMiddlePane = appMode !== "notes" || !shouldNestNotesInNavigation;

  const getFocusedPane = useCallback((): PaneId | null => {
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
  }, [foldersPanelRef, middlePaneRef, rightPaneRef]);

  const focusPane = useCallback(
    (pane: PaneId) => {
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
    },
    [appMode, foldersPanelRef, hasMiddlePane, middlePaneRef, rightPaneRef]
  );

  useGlobalShortcut("font-size-up", () => {
    if (appMode === "notes") increaseEditorFontSize();
  });
  useGlobalShortcut("font-size-down", () => {
    if (appMode === "notes") decreaseEditorFontSize();
  });
  useGlobalShortcut("font-size-reset", () => {
    if (appMode === "notes") resetEditorFontSize();
  });
  useGlobalShortcut("new-note", () => void createNewNote());
  useGlobalShortcut("lock-app", () => void lockAppNow());
  useGlobalShortcut("trash-selection", () => {
    if (appMode === "notes") moveSelectedNotesToTrash();
  });
  useGlobalShortcut("delete-selection", () => {
    if (appMode === "notes") deleteSelectedNotes();
  });

  useGlobalShortcut("toggle-sidebar", () => {
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
  });

  useGlobalShortcut("toggle-navigation-focus", () => {
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
  });

  useGlobalShortcut("cycle-panes", () => {
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
    // One key has to be able to visit every pane, so it wraps instead of
    // clamping at the ends.
    const targetPane = panes[(panes.indexOf(startPane) + 1) % panes.length];
    if (targetPane === "folders" || targetPane === "middle")
      lastLeftPaneFocusRef.current = targetPane;
    focusPane(targetPane);
  });
}
