import { lazy, Suspense } from "react";
import { Menu } from "lucide-react";

import { NoteEditor } from "@/features/editor/components/note-editor";
import { RecordingNoteHeader } from "@/features/recording/components/recording-note-header";
import { HandwritingNoteHeader } from "@/features/handwriting/components/handwriting-note-header";
import { SettingsDetailPane } from "@/features/settings/components/desktop/settings-panel";
import type { SettingsSectionId } from "@/features/settings/lib/sections";

import { focusNoScroll } from "@/shared/lib/dom";
import type { AppMode } from "@/shared/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { useDesktopEditorPane } from "./hooks/use-desktop-editor-pane";

const MultiNoteLens = lazy(() =>
  import("@/features/editor/components/lens/multi-note-lens").then((module) => ({
    default: module.MultiNoteLens,
  }))
);

type DesktopRightPaneProps = {
  appMode: AppMode;
  activeSettingsSection: SettingsSectionId;
};

export function DesktopRightPane({
  appMode,
  activeSettingsSection,
}: DesktopRightPaneProps) {
  const {
    activeNote,
    selectedNotePaths,
    activeNotePreview,
    editorMarkdown,
    handleEditorChange,
    flushSave,
    rightPaneRef,
    canOpenLens,
    shouldShowLens,
    lensNotes,
    isLensMenuOpen,
    setIsLensMenuOpen,
    openLens,
    closeLens,
    syncActiveNoteContent,
  } = useDesktopEditorPane();

  if (appMode === "notes") {
    return (
      <div className="pane editor-pane min-w-0">
        <div
          className="pane-body editor-body"
          ref={rightPaneRef}
          tabIndex={0}
          onClick={() => {
            if (shouldShowLens) {
              return;
            }
            const editorElement =
              rightPaneRef.current?.querySelector<HTMLElement>(
                ".tiptap-content[contenteditable='true']"
              ) || rightPaneRef.current;
            focusNoScroll(editorElement);
          }}
        >
          {shouldShowLens ? (
            <Suspense fallback={<div className="empty">Loading lens...</div>}>
              <MultiNoteLens
                notes={lensNotes}
                activeNote={activeNote}
                onBeforePersist={flushSave}
                onActiveNoteContentSync={syncActiveNoteContent}
                onExitLens={selectedNotePaths.length > 1 ? undefined : closeLens}
              />
            </Suspense>
          ) : (
            <div className="editor-single">
              <div className="editor-top-row">
                {canOpenLens ? (
                  <div className="editor-lens-menu-area">
                    <DropdownMenu open={isLensMenuOpen} onOpenChange={setIsLensMenuOpen}>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="editor-lens-menu-trigger"
                          aria-label="Open editor menu"
                        >
                          <Menu aria-hidden="true" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={openLens}>
                          Open Lens
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
              </div>
              <RecordingNoteHeader notePath={activeNote} preview={activeNotePreview} />
              <HandwritingNoteHeader notePath={activeNote} preview={activeNotePreview} />
              <NoteEditor
                markdown={editorMarkdown}
                onChange={handleEditorChange}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <SettingsDetailPane
      activeSection={activeSettingsSection}
      onPaneClick={() => focusNoScroll(rightPaneRef.current)}
    />
  );
}
