// Importing audio that already exists on the phone — a Voice Memo shared into
// Type, or a file picked from Files — as ordinary recording notes. Each file
// becomes one note in Feed with `transcription_status: pending`, exactly like a
// clip recorded here, so the feed, the audio player, and the transcription
// queue all treat it the same way afterwards.
//
// Two ways down to the core, picked at runtime:
//
//   importAudioFiles  — hands the core absolute paths; it copies each file
//                       itself and keeps the file's own creation date, so an
//                       hour-long memo never becomes a base64 string in JS.
//   saveAudioRecording — the fallback for native modules generated before
//                       `import_audio_files` existed (the mobile module is
//                       built on a Mac and can lag the Rust core). Reads the
//                       file into base64 here; the note is dated "now".
//
// Kept free of React and React Native so it can be unit-tested; the platform
// calls arrive as injectable deps.

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import type { AudioImportState, TranscriptionMode } from "@typenotes/shared/types";

/** How often to ask the core how the background copy is going. */
const POLL_INTERVAL_MS = 250;
/** Give up polling after this long rather than spinning forever if the worker
 * dies without ever reporting `done`. Local file copies are fast; this is
 * only a backstop. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Extensions accepted from a picker or a share sheet, mapped to the MIME type
 * the base64 fallback sends. Deliberately limited to what the core maps back to
 * a real extension (`mime_type` → `.m4a`/`.mp3`/…), so a file lands with the
 * same name in both import paths. iPhone Voice Memos are `.m4a`.
 */
const AUDIO_MIME_TYPES: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
};

export const AUDIO_FILE_EXTENSIONS = Object.keys(AUDIO_MIME_TYPES);

/** A file chosen by the document picker or handed over by the share sheet. */
export type PickedAudioFile = {
  /** `file://…` URL, or a plain absolute path. */
  uri: string;
  /** Display name, when the source knows one. */
  name?: string | null;
  /**
   * True only when the picker created a private temporary copy for Type.
   * Shared/open-in-place URLs may still point at the user's original file and
   * must never be deleted by the importer.
   */
  discardAfterImport?: boolean;
};

export type AudioImportOutcome = {
  imported: number;
  failed: number;
  /** Per-file failure messages, for the status pill / a log. */
  errors: string[];
};

export type AudioImportDeps = {
  /** Whether the linked native module can import by path. */
  supportsPathImport: () => boolean;
  importByPath: (paths: string[]) => Promise<void>;
  pollStatus: () => Promise<AudioImportState>;
  /** Base64 fallback: read a file, then save it as a recording. */
  readBase64: (uri: string) => Promise<string>;
  saveRecording: (base64: string, mimeType: string) => Promise<unknown>;
  /** Best-effort cleanup of the app's own copy of the source file. */
  discard?: (uri: string) => Promise<void>;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
};

const defaultWait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The file's lowercase extension, from a `file://` URL, a path, or a name.
 * Query strings and fragments are stripped first — iOS hands over URLs that
 * can carry them.
 */
export const audioFileExtension = (uriOrName: string): string => {
  const withoutQuery = uriOrName.split(/[?#]/)[0];
  const name = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
};

/** True when this looks like an audio file Type can import and transcribe. */
export const isSupportedAudioFile = (uriOrName: string): boolean =>
  audioFileExtension(uriOrName) in AUDIO_MIME_TYPES;

/** MIME type for the base64 fallback; audio/mp4 covers the iPhone default. */
export const audioMimeType = (uriOrName: string): string =>
  AUDIO_MIME_TYPES[audioFileExtension(uriOrName)] ?? "audio/mp4";

/**
 * A `file://` URL as the absolute path the Rust core wants. Percent-escapes
 * are decoded — a memo called "New Recording 3.m4a" arrives as
 * `New%20Recording%203.m4a`, and the core would not find that file.
 */
export const fileUriToPath = (uri: string): string => {
  const withoutQuery = uri.split(/[?#]/)[0];
  const path = withoutQuery.startsWith("file://")
    ? withoutQuery.slice("file://".length)
    : withoutQuery;
  try {
    return decodeURIComponent(path);
  } catch {
    // Malformed escapes: better to try the raw path than to fail the import.
    return path;
  }
};

/** Human label for a file, for progress and error messages. */
export const audioFileLabel = (file: PickedAudioFile): string => {
  if (file.name) {
    return file.name;
  }
  const path = fileUriToPath(file.uri);
  return path.slice(path.lastIndexOf("/") + 1) || "audio file";
};

/**
 * Wait for the core's background copy to finish, returning its final state.
 * The core resets the shared progress synchronously inside `importAudioFiles`,
 * so the first poll can never observe the previous run's `done`.
 */
const awaitImportCompletion = async (
  deps: AudioImportDeps
): Promise<AudioImportState> => {
  const wait = deps.wait ?? defaultWait;
  const now = deps.now ?? Date.now;
  const deadline = now() + POLL_TIMEOUT_MS;
  for (;;) {
    const status = await deps.pollStatus();
    if (status.done) {
      return status;
    }
    if (now() >= deadline) {
      throw new Error("Import is taking too long — check Feed in a moment.");
    }
    await wait(POLL_INTERVAL_MS);
  }
};

/** Import via the core's own file copy, one background run for all files. */
const importByPath = async (
  files: PickedAudioFile[],
  deps: AudioImportDeps
): Promise<AudioImportOutcome> => {
  await deps.importByPath(files.map((file) => fileUriToPath(file.uri)));
  const status = await awaitImportCompletion(deps);
  if (status.error) {
    // The run aborted before touching every file; report what did land.
    return {
      imported: status.imported,
      failed: Math.max(files.length - status.imported, 1),
      errors: [status.error, ...status.errors],
    };
  }
  return {
    imported: status.imported,
    failed: status.failed,
    errors: status.errors,
  };
};

/** Fallback: read each file here and save it like a freshly recorded clip. */
const importByBase64 = async (
  files: PickedAudioFile[],
  deps: AudioImportDeps
): Promise<AudioImportOutcome> => {
  let imported = 0;
  const errors: string[] = [];
  for (const file of files) {
    try {
      const base64 = await deps.readBase64(file.uri);
      if (!base64) {
        throw new Error("File is empty.");
      }
      await deps.saveRecording(base64, audioMimeType(file.name ?? file.uri));
      imported += 1;
    } catch (error) {
      errors.push(`${audioFileLabel(file)}: ${getErrorMessage(error)}`);
    }
  }
  return { imported, failed: errors.length, errors };
};

/**
 * Import the picked files as recording notes. Unsupported files are rejected
 * up front rather than saved as notes nothing can transcribe. Private
 * temporary copies made by our document picker are discarded after a fully
 * successful run. Shared/open-in-place URLs are left alone because they may
 * still point at the user's original file.
 *
 * Never throws for a per-file problem: the outcome carries the counts, so a
 * partial import still reports what landed.
 */
export const importAudioFiles = async (
  files: PickedAudioFile[],
  deps: AudioImportDeps
): Promise<AudioImportOutcome> => {
  const supported = files.filter((file) =>
    isSupportedAudioFile(file.name ?? file.uri)
  );
  const rejected = files
    .filter((file) => !supported.includes(file))
    .map((file) => `${audioFileLabel(file)}: not an audio file Type can read.`);

  if (supported.length === 0) {
    return { imported: 0, failed: rejected.length, errors: rejected };
  }

  const outcome = deps.supportsPathImport()
    ? await importByPath(supported, deps)
    : await importByBase64(supported, deps);

  const disposable = supported.filter((file) => file.discardAfterImport);
  // A partial bulk result does not say which individual paths succeeded, so
  // keep every temporary copy available for a retry rather than guessing.
  if (deps.discard && outcome.imported > 0 && outcome.failed === 0) {
    await Promise.all(
      disposable.map((file) => deps.discard!(file.uri).catch(() => {}))
    );
  }

  return {
    imported: outcome.imported,
    failed: outcome.failed + rejected.length,
    errors: [...outcome.errors, ...rejected],
  };
};

/** What happens to an imported recording next, per the folder's mode. */
const MODE_DETAIL: Record<TranscriptionMode, string> = {
  assemblyai: "transcribing via AssemblyAI",
  native: "transcribing on this device",
  desktop: "your desktop will transcribe after sync",
  off: "",
};

const countLabel = (count: number) =>
  count === 1 ? "recording" : `${count} recordings`;

/**
 * One line for the status pill. Failures win over the transcription detail —
 * knowing a file did not make it in matters more than what happens to the ones
 * that did.
 */
export const describeImportOutcome = (
  outcome: AudioImportOutcome,
  mode: TranscriptionMode,
  queueError?: string | null
): string => {
  if (outcome.imported === 0) {
    return outcome.errors[0] ?? "Nothing to import.";
  }
  const imported =
    outcome.failed > 0
      ? `Imported ${countLabel(outcome.imported)}, ${outcome.failed} failed`
      : `Imported ${countLabel(outcome.imported)}`;
  if (outcome.failed > 0) {
    return outcome.errors[0] ? `${imported} — ${outcome.errors[0]}` : imported;
  }
  if (queueError) {
    return `${imported}, but queueing failed: ${queueError}`;
  }
  const detail = MODE_DETAIL[mode];
  return detail ? `${imported} — ${detail}` : imported;
};

/** The deps wired to the real core; the platform file calls stay with callers. */
export const coreAudioImportDeps = {
  supportsPathImport: core.supportsAudioFileImport,
  importByPath: (paths: string[]) =>
    core.importAudioFiles({ source_paths: paths }),
  pollStatus: core.getAudioImportStatus,
  saveRecording: (base64: string, mimeType: string) =>
    core.saveAudioRecording({ audio_base64: base64, mime_type: mimeType }),
} satisfies Partial<AudioImportDeps>;
