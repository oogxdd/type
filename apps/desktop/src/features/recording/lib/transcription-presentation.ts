import type { RecordingListItem } from "@typenotes/shared/types";

export type TranscriptionState = "processing" | "queued" | "waiting" | "pending" | "failed" | "completed" | "archived";

export function transcriptionState(item: RecordingListItem): TranscriptionState {
  if (item.is_processing) return "processing";
  if (item.is_queued) return "queued";
  if (!item.audio_path) return item.archived_on_desktop ? "archived" : "waiting";
  // This failure was written by an older scan before the audio arrived.
  if (item.status === "failed" && item.error === "Audio file is missing.") return "pending";
  if (item.status === "completed" || item.status === "failed") return item.status;
  return "pending";
}

export function recordingLabel(notePath: string): { title: string; recordedAt: string | null } {
  const file = (notePath.split("/").pop() ?? notePath).replace(/\.md$/i, "");
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-(.*)$/.exec(file);
  const slug = match?.[5] ?? file;
  const placeholder = /^(recording|audio)-[a-f0-9-]+$/i.test(slug) ||
    /^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(slug);
  const date = match ? new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`) : null;
  return {
    title: placeholder ? "Voice recording" : slug.replace(/-/g, " "),
    recordedAt: date && Number.isFinite(date.getTime())
      ? date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : null,
  };
}

export function transcriptionErrorSummary(error: string): string {
  if (/InvalidDataError|Invalid data found when processing input|moov atom|incomplete.*m4a/i.test(error)) {
    return "This audio file is damaged or unfinished. Restore the original recording to transcribe it.";
  }
  if (/Audio file (is missing|not found)/i.test(error)) {
    return "The audio has not arrived on this device. Sync from your phone to transfer it.";
  }
  if (/Traceback|\bat .+\(.+:\d+/i.test(error)) {
    return "Transcription could not finish. Retry, or open the technical details.";
  }
  return error.length > 220 ? "Transcription failed. Open the technical details for more information." : error;
}

export function transcriptionErrorDetails(error: string): string {
  return error.replace(/\\n/g, "\n").replace(/\\"/g, '"');
}
