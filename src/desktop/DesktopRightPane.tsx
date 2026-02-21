import { useSelection } from "../contexts/SelectionContext";
import { useEditor } from "../contexts/EditorContext";
import { useNotesTree } from "../contexts/NotesTreeContext";

import { NoteEditor } from "../components/NoteEditor";
import { RecordingNoteHeader } from "../components/RecordingNoteHeader";
import {
  SettingsDetailPane,
  type SettingsSectionId,
} from "../components/SettingsPanel";
import { sanitizeRecordingEditorContent } from "../utils/format";

import { focusNoScroll } from "../utils/dom";
import type { AppMode } from "../types";

type DesktopRightPaneProps = {
  appMode: AppMode;
  activeSettingsSection: SettingsSectionId;
};

export function DesktopRightPane({
  appMode,
  activeSettingsSection,
}: DesktopRightPaneProps) {
  const { activeNote } = useSelection();
  const { noteContent, draftNoteContent, handleEditorChange, rightPaneRef } = useEditor();
  const { notePreviews, allNotePreviews } = useNotesTree();
  const activeNotePreview = activeNote
    ? notePreviews[activeNote] || allNotePreviews[activeNote]
    : undefined;
  const editorMarkdown =
    activeNote && activeNotePreview?.isRecording
      ? sanitizeRecordingEditorContent(noteContent, activeNotePreview.transcriptionStatus)
      : activeNote
        ? noteContent
        : draftNoteContent;

  if (appMode === "notes") {
    return (
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
            <RecordingNoteHeader notePath={activeNote} preview={activeNotePreview} />
            <NoteEditor
              markdown={editorMarkdown}
              onChange={handleEditorChange}
            />
          </div>
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
