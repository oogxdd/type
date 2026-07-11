import { lazy, Suspense } from "react";
import { Menu } from "lucide-react";

import { NoteEditor } from "@/components/editor/note-editor";
import { RecordingNoteHeader } from "@/components/recording/recording-note-header";
import { HandwritingNoteHeader } from "@/components/handwriting/handwriting-note-header";
import { SettingsDetailPane } from "@/components/settings/settings-panel";
import type { SettingsSectionId } from "@/lib/settings-sections";

import { focusNoScroll } from "@/lib/dom";
import type { AppMode } from "@typenotes/shared/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditorPane } from "@/hooks/use-editor-pane";

const MultiNoteLens = lazy(() =>
  import("@/components/lens/multi-note-lens").then((module) => ({
    default: module.MultiNoteLens,
  }))
);

type RightPaneProps = {
  appMode: AppMode;
  activeSettingsSection: SettingsSectionId;
  onOpenTrash: () => void;
};

export function RightPane({
  appMode,
  activeSettingsSection,
  onOpenTrash,
}: RightPaneProps) {
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
  } = useEditorPane();

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
      onOpenTrash={onOpenTrash}
      onPaneClick={() => focusNoScroll(rightPaneRef.current)}
    />
  );
}
