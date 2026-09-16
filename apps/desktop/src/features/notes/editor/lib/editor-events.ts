export const NOTE_EDITOR_ENTER_INSERT_EVENT = "note-editor-enter-insert";
const pending = new Map<string, "start" | "end">();
export const requestNoteEditorInsertMode = (notePath: string, position: "start" | "end" = "start") => {
  pending.clear();
  pending.set(notePath, position);
  window.dispatchEvent(new CustomEvent<string>(NOTE_EDITOR_ENTER_INSERT_EVENT, { detail: notePath }));
};
export const consumeNoteEditorInsertRequest = (notePath: string) => {
  const position = pending.get(notePath);
  pending.delete(notePath);
  return position;
};
