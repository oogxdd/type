import * as core from "@typenotes/mobile-core/core-api";
import { MobileRuntime } from "../lib/mobile-runtime";

export const mobileRuntime = new MobileRuntime();

export const captureStorage = () => {
  const token = mobileRuntime.workspace();
  return {
    createNote: async (content) => {
      const path = (await mobileRuntime.track(() => core.createNote({ content }), token, true)).path;
      mobileRuntime.onSaved("capture saved", "edit");
      return path;
    },
    writeNote: async (path, content, baseline) => {
      await mobileRuntime.track(() => core.writeNoteChecked(path, content, baseline ?? ""), token, true);
      mobileRuntime.onSaved("note saved", "edit");
    },
    deleteNote: async (path, baseline) => {
      await mobileRuntime.track(() => core.deleteNoteChecked(path, baseline ?? ""), token, true);
      mobileRuntime.onSaved("capture deleted");
    },
    readNote: (path) => mobileRuntime.track(() => core.readNoteForEditing(path), token),
    publishNote: (path, exists) => mobileRuntime.isCurrent(token) ? mobileRuntime.onNotesChanged(path, exists) : Promise.resolve(),
    onSaveError: (error: unknown) => { if (mobileRuntime.isCurrent(token)) mobileRuntime.saveError(error); },
  } satisfies import("../lib/note-pages").NotePageStorage;
};
export const capturePages = () => mobileRuntime.capture(captureStorage());
