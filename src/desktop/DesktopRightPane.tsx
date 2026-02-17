import { useSelection } from "../contexts/SelectionContext";
import { useEditor } from "../contexts/EditorContext";

import { NoteEditor } from "../components/NoteEditor";
import {
  SettingsDetailPane,
  type SettingsSectionId,
} from "../components/SettingsPanel";

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
            <NoteEditor
              markdown={activeNote ? noteContent : draftNoteContent}
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
