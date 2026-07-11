import { open } from "@tauri-apps/plugin-dialog";
import { invokeLogged } from "./invoke";
import type { NoteFileNameFormat } from "@typenotes/shared/types";

export type AppleImportMode = "preserve" | "flatten";

/** Preview of an exported Apple Notes folder (see backend `AppleImportScan`). */
export type AppleImportScan = {
  note_count: number;
  folder_count: number;
  skipped_files: number;
  source_name: string;
  sample_titles: string[];
};

export type AppleImportArgs = {
  source_path: string;
  mode: AppleImportMode;
  /** Target folder for `preserve` mode; ignored when flattening into Feed. */
  target_folder?: string;
  file_name_format: NoteFileNameFormat;
};

/** Pollable import progress (see backend `AppleImportState`). */
export type AppleImportState = {
  running: boolean;
  done: boolean;
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  folders_created: number;
  current: string;
  target_folder: string;
  error: string | null;
  errors: string[];
};

/** Open the native folder picker; returns the chosen path or null if cancelled. */
export const chooseAppleNotesFolder = async (
  defaultPath?: string
): Promise<string | null> => {
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath,
    title: "Select exported Apple Notes folder",
  });
  return typeof selected === "string" && selected.trim() ? selected : null;
};

export const scanAppleNotesFolder = (path: string): Promise<AppleImportScan> =>
  invokeLogged<AppleImportScan>("scan_apple_notes_folder", { path });

export const startAppleNotesImport = (args: AppleImportArgs): Promise<void> =>
  invokeLogged("start_apple_notes_import", { args });

export const getAppleImportStatus = (): Promise<AppleImportState> =>
  invokeLogged<AppleImportState>("apple_import_status");
