import type { MutableRefObject } from "react";
import { MobileEditorScreen } from "@/mobile/views/editor-view";
import { useEditor } from "@/contexts/EditorContext";
import { useSelection } from "@/contexts/SelectionContext";
import { useNotesTree } from "@/contexts/NotesTreeContext";
import type { MobileAction } from "../navigation";

type PhoneEditorScreenProps = {
  folderPath: string;
  keyboardInset: number;
  createNewNote: (
    preferredFolderPath?: string,
    initialContent?: string
  ) => Promise<string | null>;
  nextTransitionRef: MutableRefObject<"forward" | "backward" | "up" | null>;
  dispatch: React.Dispatch<MobileAction>;
};

export function PhoneEditorScreen({
  folderPath,
  keyboardInset,
  createNewNote,
  nextTransitionRef,
  dispatch,
}: PhoneEditorScreenProps) {
  const { noteContent, noteSaveError, handleEditorChange, retrySave } = useEditor();
  const { activeNote } = useSelection();
  const { allNotePreviews } = useNotesTree();

  const hasActiveNote = Boolean(activeNote);
  const editorMarkdown = noteContent;
  const activeNotePreview = activeNote ? allNotePreviews[activeNote] : undefined;

  return (
    <MobileEditorScreen
      markdown={editorMarkdown}
      onChange={handleEditorChange}
      notePath={activeNote}
      notePreview={activeNotePreview}
      hasActiveNote={hasActiveNote}
      saveError={noteSaveError}
      keyboardInset={keyboardInset}
      onRetrySave={() => {
        void retrySave();
      }}
      onPullUpCreate={async () => {
        const path = await createNewNote(folderPath);
        if (!path) {
          return;
        }
        const newFolderPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        nextTransitionRef.current = "up";
        dispatch({
          type: "replace",
          route: {
            kind: "editor",
            folderPath: newFolderPath,
            notePath: path,
          },
        });
      }}
    />
  );
}
