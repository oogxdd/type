export const NOTE_EDITOR_ENTER_INSERT_EVENT = "note-editor-enter-insert";

export const requestNoteEditorInsertMode = (notePath: string) => {
  window.dispatchEvent(
    new CustomEvent<string>(NOTE_EDITOR_ENTER_INSERT_EVENT, {
      detail: notePath,
    })
  );
};
