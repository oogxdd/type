import type { MutableRefObject } from "react";
import { MobileEditorScreen } from "../components/MobileEditorScreen";

type PhoneHomeScreenProps = {
  editorMarkdown: string;
  handleEditorChange: (markdown: string) => void;
  keyboardInset: number;
  createNewNote: (
    preferredFolderPath?: string,
    initialContent?: string
  ) => Promise<string | null>;
  openEditorRoute: (notePath: string, folderPath?: string) => void;
  nextTransitionRef: MutableRefObject<"forward" | "backward" | "up" | null>;
};

export function PhoneHomeScreen({
  editorMarkdown,
  handleEditorChange,
  keyboardInset,
  createNewNote,
  openEditorRoute,
  nextTransitionRef,
}: PhoneHomeScreenProps) {
  return (
    <MobileEditorScreen
      markdown={editorMarkdown}
      onChange={handleEditorChange}
      hasActiveNote={false}
      isSaving={false}
      saveError={null}
      keyboardInset={keyboardInset}
      onRetrySave={() => Promise.resolve()}
      draftMode
      onPullUpCreate={async () => {
        const draft = editorMarkdown.trimEnd();
        const path = await createNewNote(undefined, draft);
        if (!path) {
          return;
        }
        nextTransitionRef.current = "up";
        openEditorRoute(path);
      }}
    />
  );
}
