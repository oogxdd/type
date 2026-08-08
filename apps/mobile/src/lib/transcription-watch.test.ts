import { describe, expect, it, vi } from "vitest";

import type { RecordingListItem, RecordingsListResult } from "@typenotes/shared/types";

import {
  describeTranscriptionOutcome,
  waitForTranscription,
} from "./transcription-watch";

const NOTE = "Feed/2026-08-08-voice.md";

const item = (overrides: Partial<RecordingListItem> = {}): RecordingListItem => ({
  note_path: NOTE,
  folder_path: "Feed",
  audio_path: "Recordings/audio-1.m4a",
  status: "processing",
  error: null,
  updated_ms: 1,
  is_queued: false,
  is_processing: true,
  ...overrides,
});

const listing = (...recordings: RecordingListItem[]): RecordingsListResult => ({
  queue: {
    running: false,
    current_recording: null,
    pending: [],
    in_flight: 0,
    progress: null,
  },
  recordings,
});

/** A clock the test advances by hand, so nothing waits in real time. */
const fakeClock = () => {
  let ms = 0;
  return {
    now: () => ms,
    sleep: async (delta: number) => {
      ms += delta;
    },
  };
};

describe("waitForTranscription", () => {
  it("polls until the recording completes", async () => {
    const clock = fakeClock();
    const list = vi
      .fn<() => Promise<RecordingsListResult>>()
      .mockResolvedValueOnce(listing(item({ status: "queued" })))
      .mockResolvedValueOnce(listing(item({ status: "processing" })))
      .mockResolvedValue(listing(item({ status: "completed", is_processing: false })));

    const outcome = await waitForTranscription(NOTE, { list, sleep: clock.sleep, now: clock.now });

    expect(outcome).toEqual({ status: "completed" });
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("surfaces the failure reason the core wrote onto the note", async () => {
    const clock = fakeClock();
    const list = vi.fn(async () =>
      listing(
        item({
          status: "failed",
          error: "AssemblyAI rejected this API key (HTTP 401).",
        })
      )
    );

    const outcome = await waitForTranscription(NOTE, { list, sleep: clock.sleep, now: clock.now });

    expect(outcome).toEqual({
      status: "failed",
      error: "AssemblyAI rejected this API key (HTTP 401).",
    });
  });

  it("falls back to a generic message when a failure carries no reason", async () => {
    const clock = fakeClock();
    const list = vi.fn(async () => listing(item({ status: "failed", error: "  " })));

    const outcome = await waitForTranscription(NOTE, { list, sleep: clock.sleep, now: clock.now });

    expect(outcome).toEqual({ status: "failed", error: "Transcription failed." });
  });

  it("keeps waiting through a failed poll rather than reporting a failure", async () => {
    const clock = fakeClock();
    const list = vi
      .fn<() => Promise<RecordingsListResult>>()
      .mockRejectedValueOnce(new Error("core busy"))
      .mockResolvedValue(listing(item({ status: "completed" })));

    const outcome = await waitForTranscription(NOTE, { list, sleep: clock.sleep, now: clock.now });

    expect(outcome).toEqual({ status: "completed" });
  });

  it("gives up as pending — not failed — when the job outlives the timeout", async () => {
    const clock = fakeClock();
    const list = vi.fn(async () => listing(item({ status: "processing" })));

    const outcome = await waitForTranscription(NOTE, {
      list,
      sleep: clock.sleep,
      now: clock.now,
      intervalMs: 1000,
      timeoutMs: 3000,
    });

    expect(outcome).toEqual({ status: "pending" });
    expect(list).toHaveBeenCalledTimes(4);
  });

  it("waits out a note that is not in the listing yet", async () => {
    const clock = fakeClock();
    const list = vi
      .fn<() => Promise<RecordingsListResult>>()
      .mockResolvedValueOnce(listing())
      .mockResolvedValue(listing(item({ status: "completed" })));

    const outcome = await waitForTranscription(NOTE, { list, sleep: clock.sleep, now: clock.now });

    expect(outcome).toEqual({ status: "completed" });
  });
});

describe("describeTranscriptionOutcome", () => {
  it("reports success, the reason for failure, and an unfinished job", () => {
    expect(describeTranscriptionOutcome({ status: "completed" })).toEqual({
      kind: "success",
      text: "Transcribed",
    });
    expect(
      describeTranscriptionOutcome({ status: "failed", error: "key rejected" })
    ).toEqual({ kind: "error", text: "key rejected" });
    expect(describeTranscriptionOutcome({ status: "pending" })).toEqual({
      kind: "success",
      text: "Saved — still transcribing",
    });
  });
});
