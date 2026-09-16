import { describe, expect, it } from "vitest";
import type { RecordingListItem } from "@typenotes/shared/types";
import { recordingLabel, transcriptionState, transcriptionErrorSummary, transcriptionErrorDetails } from "./transcription-presentation";

const item: RecordingListItem = {
  note_path: "Feed/recording.md", folder_path: "Feed", audio_path: null,
  archived_on_desktop: false, status: "failed", error: "Audio file is missing.",
  updated_ms: null, is_queued: false, is_processing: false,
};

describe("transcription presentation", () => {
  it("distinguishes audio awaiting transfer from an actual transcription failure", () => {
    expect(transcriptionState(item)).toBe("waiting");
    expect(transcriptionState({ ...item, audio_path: "Recordings/a.m4a" })).toBe("pending");
    expect(transcriptionState({ ...item, audio_path: "Recordings/a.m4a", error: "InvalidDataError" })).toBe("failed");
    expect(transcriptionState({ ...item, is_processing: true })).toBe("processing");
  });
  it("uses recording dates without displaying generated identifiers as titles", () => {
    const label = recordingLabel("Feed/2026-09-15T16-09-29Z-recording-71b3-bcd7-4c8d64c278b9.md");
    expect(label.title).toBe("Voice recording");
    expect(label.recordedAt).toBeTruthy();
    expect(recordingLabel("Feed/2026-09-03T00-29-54Z-че-могу.md").title).toBe("че могу");
  });
  it("summarizes old decoder tracebacks and preserves readable diagnostics", () => {
    expect(transcriptionErrorSummary("Whisper transcription failed: Traceback\\nav.error.InvalidDataError: Invalid data found when processing input"))
      .toContain("damaged or unfinished");
    expect(transcriptionErrorDetails('Traceback\\nFile \\"test.py\\"')).toBe('Traceback\nFile "test.py"');
  });
});
