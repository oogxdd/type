// Shared helpers for the async "job" queues (recording transcription,
// handwriting OCR). Both list-item shapes carry the same status fields, so the
// preview-invalidation signature is computed the same way for each.

type JobSignatureFields = {
  note_path: string;
  status: string;
  updated_ms: number | null;
  error: string | null;
  is_queued: boolean;
  is_processing: boolean;
};

/**
 * Stable signature of a job list, used to decide when note previews need to be
 * re-fetched. It is order-independent (sorted), so reordering alone never
 * triggers a needless invalidation — only a changed status/timestamp/error does.
 */
export const jobListSignature = (items: JobSignatureFields[]): string =>
  items
    .map((item) =>
      [
        item.note_path,
        item.status,
        item.updated_ms ?? "",
        item.error ?? "",
        item.is_queued ? "1" : "0",
        item.is_processing ? "1" : "0",
      ].join("|")
    )
    .sort()
    .join("||");
