import { useCallback, useEffect, useRef } from "react";
import { createNote, deleteItems, writeNote } from "@/data/notes-api";
import { useEditor } from "@/contexts/editor-context";
import { useNotesTree } from "@/contexts/notes-tree-context";
import { useProfiles } from "@/contexts/profiles-context";
import { useSelection } from "@/app/state/selection-context";
import { MobileEditorScreen } from "@/mobile/views/editor-view";
import { FEED_FOLDER_PATH } from "../types";

type PhoneHomeScreenProps = {
  keyboardInset: number;
};

export function PhoneHomeScreen({ keyboardInset }: PhoneHomeScreenProps) {
  const {
    noteContent,
    draftNoteContent,
    noteSaveError,
    handleEditorChange,
    clearNote,
    clearDraft,
    primeNoteContent,
    flushSave,
    retrySave,
  } = useEditor();
  const { syncSettings } = useProfiles();
  const { refreshTree } = useNotesTree();
  const {
    activeNote,
    enterMobileHome,
    setSelectedFolders,
    setLastSelectedFolder,
    setActiveFolder,
    setSelectedNotes,
    setLastSelectedNote,
    setActiveNote,
  } = useSelection();
  const editorMarkdown = activeNote ? noteContent : draftNoteContent;
  const latestMarkdownRef = useRef(editorMarkdown);
  const createPromiseRef = useRef<Promise<string | null> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    latestMarkdownRef.current = editorMarkdown;
  }, [editorMarkdown]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const ensureHomeNoteCreated = useCallback(
    async (contentOverride?: string) => {
      if (activeNote) {
        return activeNote;
      }
      const initialContent = contentOverride ?? latestMarkdownRef.current;
      if (!initialContent.trim()) {
        return null;
      }
      if (createPromiseRef.current) {
        return createPromiseRef.current;
      }

      createPromiseRef.current = (async () => {
        try {
          primeNoteContent(initialContent);
          const created = await createNote(
            FEED_FOLDER_PATH,
            initialContent,
            undefined,
            syncSettings.noteFileNameFormat
          );
          const path = created.path;
          const latestContent = latestMarkdownRef.current;
          if (!latestContent.trim()) {
            await deleteItems([path]);
            await refreshTree();
            return null;
          }
          if (latestContent !== initialContent) {
            primeNoteContent(latestContent);
            await writeNote(path, latestContent);
          }
          await refreshTree();
          if (!mountedRef.current) {
            return path;
          }
          setSelectedFolders(new Set([FEED_FOLDER_PATH]));
          setLastSelectedFolder(FEED_FOLDER_PATH);
          setActiveFolder(FEED_FOLDER_PATH);
          setSelectedNotes(new Set([path]));
          setLastSelectedNote(path);
          setActiveNote(path);
          clearDraft();
          return path;
        } catch (error) {
          console.error("[mobile] failed to persist home note", error);
          return null;
        }
      })();

      try {
        return await createPromiseRef.current;
      } finally {
        createPromiseRef.current = null;
      }
    },
    [
      activeNote,
      clearDraft,
      primeNoteContent,
      refreshTree,
      setActiveFolder,
      setActiveNote,
      setLastSelectedFolder,
      setLastSelectedNote,
      setSelectedFolders,
      setSelectedNotes,
      syncSettings.noteFileNameFormat,
    ]
  );

  const handleHomeEditorChange = useCallback(
    (markdown: string) => {
      latestMarkdownRef.current = markdown;
      handleEditorChange(markdown);
      if (activeNote || !markdown.trim()) {
        return;
      }
      void ensureHomeNoteCreated(markdown);
    },
    [activeNote, ensureHomeNoteCreated, handleEditorChange]
  );

  useEffect(() => {
    const persistHomeDraft = () => {
      if (document.visibilityState === "hidden") {
        void ensureHomeNoteCreated();
      }
    };
    const persistOnPageHide = () => {
      void ensureHomeNoteCreated();
    };
    document.addEventListener("visibilitychange", persistHomeDraft);
    window.addEventListener("pagehide", persistOnPageHide);
    return () => {
      document.removeEventListener("visibilitychange", persistHomeDraft);
      window.removeEventListener("pagehide", persistOnPageHide);
    };
  }, [ensureHomeNoteCreated]);

  const resetHomeComposer = useCallback(() => {
    enterMobileHome();
    clearNote();
    clearDraft();
    latestMarkdownRef.current = "";
  }, [clearDraft, clearNote, enterMobileHome]);

  return (
    <MobileEditorScreen
      markdown={editorMarkdown}
      onChange={handleHomeEditorChange}
      notePath={activeNote}
      hasActiveNote={Boolean(activeNote)}
      saveError={noteSaveError}
      keyboardInset={keyboardInset}
      onRetrySave={() => {
        void retrySave();
      }}
      draftMode={!activeNote}
      onPullUpCreate={async () => {
        const currentContent = latestMarkdownRef.current;
        if (!currentContent.trim() && !activeNote) {
          return;
        }
        if (activeNote && !currentContent.trim()) {
          await deleteItems([activeNote]);
          await refreshTree();
          resetHomeComposer();
          return;
        }
        if (activeNote) {
          await flushSave();
        } else {
          const path = await ensureHomeNoteCreated(currentContent);
          if (!path) {
            return;
          }
        }
        resetHomeComposer();
      }}
    />
  );
}
