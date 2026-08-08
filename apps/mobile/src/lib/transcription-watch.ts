// Waiting for a queued transcription to finish, so the dictation button can
// report what actually happened.
//
// The core's transcription queue is a background Rust thread that rewrites the
// note on disk; nothing pushes to JS when a job ends. Until this existed the
// phone said "Saved — transcribing via AssemblyAI" and then went quiet forever,
// which looks identical whether the transcript arrived or the API rejected the
// key. Polling `listRecordings` is how the app finds out — the same call the
// recordings list already uses.

import type { RecordingsListResult } from "@typenotes/shared/types";

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export type TranscriptionOutcome =
  | { status: "completed" }
  | { status: "failed"; error: string }
  /** Still running when we stopped watching — not a failure, just unknown. */
  | { status: "pending" };

export type WatchOptions = {
  list: () => Promise<RecordingsListResult>;
  /** Injected so tests don't wait in real time. */
  sleep: (ms: number) => Promise<void>;
  intervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
};

const DEFAULT_INTERVAL_MS = 1500;
/** Long enough for a voice note; past this the feed row is the source of truth. */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Poll until `notePath` leaves the queue, or until the timeout. A note that has
 * vanished from the list (deleted mid-flight) reports `pending` rather than
 * inventing a failure.
 */
export const waitForTranscription = async (
  notePath: string,
  options: WatchOptions
): Promise<TranscriptionOutcome> => {
  const {
    list,
    sleep,
    intervalMs = DEFAULT_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = Date.now,
  } = options;
  const deadline = now() + timeoutMs;

  for (;;) {
    let entry;
    try {
      const result = await list();
      entry = result.recordings.find((item) => item.note_path === notePath);
    } catch {
      // A failed poll says nothing about the job; keep waiting for the deadline.
      entry = undefined;
    }

    if (entry && TERMINAL_STATUSES.has(entry.status)) {
      return entry.status === "completed"
        ? { status: "completed" }
        : {
            status: "failed",
            error: entry.error?.trim() || "Transcription failed.",
          };
    }

    if (now() >= deadline) {
      return { status: "pending" };
    }
    await sleep(intervalMs);
  }
};

/** The pill text for a finished (or still-running) transcription. */
export const describeTranscriptionOutcome = (
  outcome: TranscriptionOutcome
): { kind: "success" | "error"; text: string } => {
  switch (outcome.status) {
    case "completed":
      return { kind: "success", text: "Transcribed" };
    case "failed":
      return { kind: "error", text: outcome.error };
    case "pending":
      return { kind: "success", text: "Saved — still transcribing" };
  }
};
