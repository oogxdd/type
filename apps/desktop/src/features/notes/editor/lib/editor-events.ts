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

export const NOTE_EDITOR_FOCUS_EVENT = "note-editor-focus";
let pendingFocus: string | null = null;
/** Survives async note loading; the most recent selection owns focus. */
export const requestNoteEditorFocus = (notePath: string) => {
  pendingFocus = notePath;
  window.dispatchEvent(new Event(NOTE_EDITOR_FOCUS_EVENT));
};
export const consumeNoteEditorFocusRequest = (notePath: string) => {
  if (pendingFocus !== notePath) return false;
  pendingFocus = null;
  return true;
};

/** The group owns initial focus; do not wait for the clicked note to load. */
export const consumeNoteEditorGroupFocusRequest = (paths: readonly string[]) => {
  if (!pendingFocus || !paths.includes(pendingFocus)) return false;
  pendingFocus = null;
  return true;
};
