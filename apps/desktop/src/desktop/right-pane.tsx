import { lazy, Suspense } from "react";
import { Menu } from "lucide-react";

import { getActiveNoteEditor } from "@/features/notes/editor/lib/editor-bridge";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import { useSelection } from "@/app/state/selection-store";
import { NoteEditor } from "@/features/notes/editor/components/note-editor";
import { RecordingNoteHeader } from "@/features/recording/components/recording-note-header";
import { HandwritingNoteHeader } from "@/features/handwriting/components/handwriting-note-header";
import { SettingsDetailPane } from "@/features/settings/components/desktop/settings-panel";
import type { SettingsSectionId } from "@/features/settings/lib/sections";

import { focusNoScroll } from "@/shared/lib/dom";
import type { AppMode } from "@typenotes/shared/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { useDesktopEditorPane } from "./hooks/use-desktop-editor-pane";

const MultiNoteLens = lazy(() =>
  import("@/features/lens/components/multi-note-lens").then((module) => ({
    default: module.MultiNoteLens,
  }))
);

const NoteEditorGroup = lazy(() =>
  import("@/features/notes/editor/components/note-editor-group").then((module) => ({
    default: module.NoteEditorGroup,
  }))
);

type DesktopRightPaneProps = {
  appMode: AppMode;
  activeSettingsSection: SettingsSectionId;
  onOpenTrash: () => void;
};

export function DesktopRightPane({
  appMode,
  activeSettingsSection,
  onOpenTrash,
}: DesktopRightPaneProps) {
  const { session } = useEditor();
  const selectNote = useSelection((state) => state.selectNote);
  const {
    activeNote,
    loadedNotePath,
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
            if (shouldShowLens || selectedNotePaths.length > 1) {
              return;
            }
            const editorElement = getActiveNoteEditor()?.view.dom ||
              rightPaneRef.current?.querySelector<HTMLElement>(
                ".tiptap-content[contenteditable='true']"
              ) || rightPaneRef.current;
            focusNoScroll(editorElement);
          }}
        >
          {[...session.documents].filter(([path, entry]) => entry.dirty && entry.error && !selectedNotePaths.includes(path)).map(([path, entry]) => (
            <div className="note-editor-error" role="alert" key={path}>
              {path}: {entry.error}
              <button type="button" onClick={() => void session.flush(path).catch(() => {})}>Retry save</button>
              <button type="button" onClick={() => selectNote(path)}>Open draft</button>
            </div>
          ))}
          {selectedNotePaths.length > 0 && (selectedNotePaths.length > 1 || !shouldShowLens) ? (
            <Suspense fallback={<div className="empty">Loading selected notes...</div>}>
              <div className="editor-single">
                <div className="editor-top-row" data-tauri-drag-region>
                  {canOpenLens ? <button type="button" className="editor-lens-menu-trigger" onClick={openLens} aria-label="Open Lens"><Menu aria-hidden="true" /></button> : null}
                </div>
                <NoteEditorGroup notes={lensNotes} />
              </div>
            </Suspense>
          ) : shouldShowLens ? (
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
              <div className="editor-top-row" data-tauri-drag-region>
                {canOpenLens ? (
                  <div className="editor-lens-menu-area" data-tauri-drag-region>
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
                documentKey={loadedNotePath}
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
