//! Import port — bringing notes in from external sources.
//!
//! The only source today is an *exported Apple Notes folder tree* (Markdown /
//! HTML / plain-text files produced by a tool like the "Exporter" app). The
//! contract is intentionally source-agnostic so other importers can slot in
//! later.
//!
//! # DTOs
//! - `AppleImportScan` — preview of a chosen folder (note/folder/skipped counts,
//!   suggested target name, a few sample titles).
//! - `AppleImportArgs` — `{ source_path, mode, target_folder?, file_name_format }`.
//! - `AppleImportMode` — `preserve` (mirror hierarchy) | `flatten` (all into Feed).
//! - `AppleImportState` — pollable progress snapshot.
//!
//! # Operations
//! - `scan(source) -> AppleImportScan`
//! - `start(args)` — begin an import (one at a time).
//! - `status() -> AppleImportState`
//!
//! # Implementation notes
//! - **Scan** walks the folder recursively, counting files with a note text
//!   extension (`md`, `markdown`, `txt`, `text`, `html`, `htm`) as notes and all
//!   others as skipped. Dotfiles/dot-dirs are ignored. `source_name` is the base
//!   name of the folder, used as the default `target_folder`.
//! - **Start** must reject a second concurrent run, resolve the active profile's
//!   notes root once, then perform the import off the UI thread. Progress is
//!   published to a shared snapshot rather than via events.
//! - **Dates**: creation time is taken from YAML front-matter
//!   (`created_ms`/`created`/`creationDate`/`created_at`/`date`/`created-date`,
//!   first match wins) parsed as epoch ms, RFC 3339, `YYYY-MM-DD HH:MM:SS`, or
//!   `YYYY-MM-DD`; otherwise the file's filesystem created (or modified) time.
//!   The resolved timestamp is written to both `created_ms` and `updated_ms`.
//! - **Front-matter** from the source is always stripped from the body so it
//!   never double-nests under the app's own front-matter.
//! - **HTML** is converted to Markdown best-effort (headings, paragraphs,
//!   `<br>`/`<div>` breaks, bold/italic, lists, links, entities).
//! - **preserve** places notes under `target_folder/<relative dirs>`; **flatten**
//!   places every note directly in `Feed`. Path segments are sanitized; a target
//!   that resolves into reserved storage (Recordings/attachments) is rejected.
//! - **Encryption** is transparent: notes are written via
//!   `write_note_with_front_matter`, which encrypts the body when security is
//!   unlocked. Import therefore requires the app to be unlocked.

/// Source-agnostic note import contract. See module docs for behavior.
pub trait ImportPort {
    type Scan;
    type Args;
    type State;
    type Error;

    /// Preview an export folder without importing anything.
    fn scan(source: &std::path::Path) -> Result<Self::Scan, Self::Error>;

    /// Begin importing (rejected if another import is already running).
    fn start(args: Self::Args) -> Result<(), Self::Error>;

    /// Current/last import progress.
    fn status() -> Self::State;
}
