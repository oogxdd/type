use serde::Serialize;

use super::notes::NoteFileNameFormat;

// ── Types ──────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct HandwritingWriteResult {
    pub folder_path: String,
    pub note_path: String,
    pub attachment_path: String,
}

#[derive(Serialize)]
pub struct OcrQueueResult {
    pub scanned: usize,
    pub queued: usize,
    pub skipped: usize,
    pub in_flight: usize,
}

#[derive(Serialize)]
pub struct OcrQueueSnapshot {
    pub running: bool,
    pub current_note: Option<String>,
    pub pending: Vec<String>,
    pub in_flight: usize,
}

#[derive(Serialize)]
pub struct OcrListItem {
    pub note_path: String,
    pub folder_path: String,
    pub attachment_path: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub updated_ms: Option<i64>,
    pub is_queued: bool,
    pub is_processing: bool,
}

#[derive(Serialize)]
pub struct OcrListResult {
    pub queue: OcrQueueSnapshot,
    pub jobs: Vec<OcrListItem>,
}

// ── Trait ──────────────────────────────────────────────────────────────────────

pub trait HandwritingService {
    fn save_attachment(
        &self,
        image_base64: &str,
        mime_type: Option<&str>,
        file_name: Option<&str>,
        folder_path: Option<&str>,
        file_name_format: NoteFileNameFormat,
    ) -> Result<HandwritingWriteResult, String>;
    fn queue_ocr(
        &self,
        provider: &str,
        api_key: &str,
        model: &str,
    ) -> Result<OcrQueueResult, String>;
    fn list_ocr_jobs(&self) -> Result<OcrListResult, String>;
}

/// Internal gateway for attachment persistence and OCR queue workers.
pub trait HandwritingGateway {
    type SaveArgs;
    type WriteResult;
    type QueueArgs;
    type QueueResult;
    type ListResult;
    type LocalStatusArgs;
    type LocalStatus;

    fn save(&self, args: Self::SaveArgs) -> Result<Self::WriteResult, String>;
    fn queue(&self, args: Self::QueueArgs) -> Result<Self::QueueResult, String>;
    fn list(&self) -> Result<Self::ListResult, String>;
    fn local_status(&self, args: Self::LocalStatusArgs) -> Self::LocalStatus;
}

// ─── Implementation Notes ─────────────────────────────────────────────────────
//
// HandwritingService handles saving handwritten image attachments and running OCR on them.
//
// save_attachment(image_base64, mime_type, file_name, folder_path, file_name_format)
//   in:  image_base64 — base64-encoded image bytes (may have data URI prefix)
//        mime_type — e.g. "image/png", "image/jpeg". Used to detect format
//        file_name — original filename, used as fallback for format detection
//        folder_path — where to create the note, defaults to "Feed"
//        file_name_format — how to name the note file
//   out: HandwritingWriteResult — folder_path, note_path, attachment_path (all relative)
//   - Decodes base64, determines image format from mime or filename
//   - Saves image to Attachments/ storage folder as attachment-{uuid}.{ext}
//   - Creates a markdown note with front-matter linking to the attachment
//   - Front-matter includes: type="handwriting_attachment", handwriting_attachment_path, ocr_status="pending"
//   - Supported formats: png, jpg/jpeg, webp, gif
//
// queue_ocr(provider, api_key, model)
//   in:  provider — "local", "openai", or "huggingface"
//        provider-specific credentials/model values (local uses a model cache path)
//   out: OcrQueueResult — how many scanned, queued, skipped, in flight
//   - Scans all handwriting notes, skips completed or in-flight ones
//   - Queues pending/failed notes for OCR processing
//   - Local: EasyOCR in an app-managed Python environment
//   - OpenAI: sends image as data URL to the Responses API with a handwriting extraction prompt
//   - HuggingFace: sends raw image bytes to the Inference API, retries on 503 (model loading)
//   - On completion, writes extracted text as the note body
//
// list_ocr_jobs()
//   in:  nothing
//   out: OcrListResult — queue snapshot + list of all handwriting notes with status
//   - Sorted by updated_ms descending (newest first)
//   - Each item includes whether it's currently queued or being processed
//
// Key assumptions for any implementation:
//   - Image files are stored in a hidden Attachments/ folder, separate from notes
//   - Each handwriting note links to its image via front-matter
//   - OCR is queue-based with a background worker thread (same pattern as recording transcription)
//   - Only one OCR job runs at a time (sequential processing)
//   - Status lifecycle: pending → queued → processing → completed | failed
//   - Provider dispatch is isolated from queue and note lifecycle behavior
