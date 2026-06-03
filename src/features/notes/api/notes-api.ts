import { invokeLogged } from "@/data/invoke";
import type {
  CreateNoteResult,
  FolderNode,
  NoteFileNameFormat,
  NoteMeta,
  SetOrderArgs,
} from "@/types";

export const getTree = (): Promise<FolderNode> =>
  invokeLogged<FolderNode>("get_tree");

export const readNote = (path: string): Promise<string> =>
  invokeLogged<string>("read_note", { path });

export const createNote = (
  folderPath?: string,
  content = "",
  timestampMs?: number,
  fileNameFormat?: NoteFileNameFormat
): Promise<CreateNoteResult> =>
  invokeLogged<CreateNoteResult>("create_note", {
    args: {
      folder_path: folderPath,
      content,
      timestamp_ms: timestampMs,
      file_name_format: fileNameFormat,
    },
  });

export const writeNote = (path: string, content: string): Promise<void> =>
  invokeLogged("write_note", { path, content });

export const setNoteTimestamp = (path: string, timestampMs: number): Promise<void> =>
  invokeLogged("set_note_timestamp", {
    args: {
      path,
      timestamp_ms: timestampMs,
    },
  });

export const getNoteMeta = (path: string): Promise<NoteMeta> =>
  invokeLogged<NoteMeta>("get_note_meta", { path });

export const deleteItems = (items: string[]): Promise<void> =>
  invokeLogged("delete_items", { items });

export const moveItems = (items: string[], destination: string): Promise<void> =>
  invokeLogged("move_items", { items, destination });

export const renameItem = (path: string, newName: string): Promise<string> =>
  invokeLogged<string>("rename_item", { path, newName });

export const setOrder = (args: SetOrderArgs): Promise<void> =>
  invokeLogged("set_order", { args });
