import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AppMode, PaneId } from "@typenotes/shared/types";
import { useAppearance } from "@/app/state/appearance-store";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { focusNoScroll } from "@/shared/lib/dom";

type UsePaneShortcutsArgs = {
  appMode: AppMode;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  deleteSelectedNotes: () => void;
  lockAppNow: () => Promise<void>;
  foldersPanelRef: React.RefObject<HTMLDivElement | null>;
  middlePaneRef: React.RefObject<HTMLDivElement | null>;
  lastLeftPaneFocusRef: React.MutableRefObject<"folders" | "middle">;
};

/**
 * Desktop global keyboard shortcuts and pane focus management:
 * cmd/ctrl + T (toggle sidebar), W (toggle navigation/editor), K/J (cycle all panes),
 * N (new note), Backspace (delete), +/-/0 (editor font size), shift+L (lock).
 * Tracks the last-focused left pane so toggling the sidebar can restore it.
 */
export function usePaneShortcuts({
  appMode,
  sidebarCollapsed,
  setSidebarCollapsed,
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
      const isLockShortcut = code === "KeyL" && event.shiftKey;
      if (
        code !== "KeyT" &&
        code !== "KeyW" &&
        code !== "KeyK" &&
        code !== "KeyJ" &&
        code !== "KeyN" &&
        code !== "Backspace" &&
        code !== "Equal" &&
        code !== "Minus" &&
        code !== "Digit0" &&
        code !== "NumpadAdd" &&
        code !== "NumpadSubtract" &&
        code !== "Numpad0" &&
        !isLockShortcut
      )
        return;
      event.preventDefault();

      if (code === "Equal" || code === "NumpadAdd") {
        if (appMode === "notes") increaseEditorFontSize();
        return;
      }
      if (code === "Minus" || code === "NumpadSubtract") {
        if (appMode === "notes") decreaseEditorFontSize();
        return;
      }
      if (code === "Digit0" || code === "Numpad0") {
        if (appMode === "notes") resetEditorFontSize();
        return;
      }
      if (code === "KeyN") {
        void createNewNote();
        return;
      }
      if (isLockShortcut) {
        void lockAppNow();
        return;
      }
      if (code === "Backspace") {
        if (appMode === "notes") deleteSelectedNotes();
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
          lastLeftPaneFocusRef.current = "folders";
          requestAnimationFrame(() => focusPane("folders"));
          return;
        }
        const currentPane = getFocusedPane();
        if (currentPane === "right") {
          lastLeftPaneFocusRef.current = "folders";
          focusPane("folders");
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
  }, [
    appMode,
    createNewNote,
    deleteSelectedNotes,
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
