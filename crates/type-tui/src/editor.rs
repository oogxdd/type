//! The note editor and, more importantly, its lifecycle policy.
//!
//! `tui-textarea-2` only gives us a buffer, a cursor, soft wrapping and undo.
//! Everything that makes this a *notes* editor rather than a text box lives
//! here, and it mirrors the desktop's `use-note-editor.ts` + `note-autoname.ts`:
//!
//!   * writes are debounced by [`DEBOUNCE`] (400ms, same as the desktop);
//!   * a note whose body becomes empty is deleted when we flush it;
//!   * a note whose file name is still provisional is renamed to a slug built
//!     from its content.
//!
//! None of this lives in `type-core` — the core exposes `write_note`,
//! `delete_items` and `rename_item`, and each shell decides when to call them.

use std::time::{Duration, Instant};

use tui_textarea::{TextArea, WrapMode};
use type_core::slug_from_content;

use crate::core::Notes;

/// Same debounce the desktop editor uses. Keep them in sync: it is the interval
/// that decides how much work a crash can lose.
pub const DEBOUNCE: Duration = Duration::from_millis(400);

/// What a flush actually did, so the caller can refresh the list and selection.
#[derive(Default)]
pub struct FlushOutcome {
    /// The note was empty and has been deleted.
    pub deleted: bool,
    /// The note was renamed; this is its new root-relative path.
    pub renamed_to: Option<String>,
}

pub struct Editor {
    pub area: TextArea<'static>,
    /// Root-relative path of the open note, if any.
    pub path: Option<String>,
    /// Set on every buffer mutation, cleared by [`Editor::flush`].
    dirty_since: Option<Instant>,
    /// Body as last written to disk. Lets us skip no-op writes when the user
    /// moves the cursor around without changing anything.
    saved: String,
}

impl Editor {
    pub fn new() -> Self {
        let mut area = TextArea::default();
        // The reason this crate uses the `tui-textarea-2` fork at all: notes are
        // markdown paragraphs stored as single long lines, and the original
        // widget scrolls them horizontally instead of wrapping.
        area.set_wrap_mode(WrapMode::WordOrGlyph);
        area.set_max_histories(500);
        Self {
            area,
            path: None,
            dirty_since: None,
            saved: String::new(),
        }
    }

    /// Load a note into the buffer. The caller is responsible for flushing the
    /// previously open note first — see [`Editor::flush`].
    pub fn open(&mut self, path: String, body: String) {
        let lines: Vec<String> = if body.is_empty() {
            vec![String::new()]
        } else {
            body.lines().map(str::to_string).collect()
        };
        let mut area = TextArea::new(lines);
        area.set_wrap_mode(WrapMode::WordOrGlyph);
        area.set_max_histories(500);
        self.area = area;
        self.path = Some(path);
        self.saved = body;
        self.dirty_since = None;
    }

    /// Drop the buffer without touching disk (used after a delete).
    pub fn close(&mut self) {
        self.area = TextArea::default();
        self.area.set_wrap_mode(WrapMode::WordOrGlyph);
        self.path = None;
        self.saved = String::new();
        self.dirty_since = None;
    }

    /// Record that the buffer changed. Restarting the clock on every keystroke
    /// is what makes this a debounce rather than a fixed-interval autosave.
    pub fn touch(&mut self) {
        self.dirty_since = Some(Instant::now());
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty_since.is_some()
    }

    /// True once the buffer has been idle long enough to write.
    pub fn debounce_elapsed(&self) -> bool {
        self.dirty_since
            .is_some_and(|since| since.elapsed() >= DEBOUNCE)
    }

    pub fn text(&self) -> String {
        self.area.lines().join("\n")
    }

    /// Persist the buffer, applying the empty-note and auto-rename policies.
    ///
    /// Safe to call when nothing is dirty — it becomes a no-op, which is why
    /// callers can flush unconditionally before navigating away.
    pub fn flush(&mut self, notes: &Notes) -> Result<FlushOutcome, String> {
        let Some(path) = self.path.clone() else {
            return Ok(FlushOutcome::default());
        };
        let body = self.text();

        // Nothing changed since the last write: skip the filesystem entirely.
        if !self.is_dirty() && body == self.saved {
            return Ok(FlushOutcome::default());
        }

        // Empty-note cleanup. The desktop deletes a note the moment a dirty
        // buffer is emptied and focus moves elsewhere; flushing is exactly that
        // moment for us.
        if body.trim().is_empty() {
            notes.delete_items(vec![path])?;
            self.close();
            return Ok(FlushOutcome {
                deleted: true,
                ..Default::default()
            });
        }

        notes.write_note(&path, &body)?;
        self.saved = body.clone();
        self.dirty_since = None;

        // Auto-rename runs after the write so the file we rename already holds
        // the content the slug was derived from.
        let mut outcome = FlushOutcome::default();
        if let Some(new_name) = auto_rename_target(&path, &body) {
            let new_path = notes.rename_item(&path, &new_name)?;
            self.path = Some(new_path.clone());
            outcome.renamed_to = Some(new_path);
        }
        Ok(outcome)
    }
}

// ---------------------------------------------------------------------------
// Auto-rename
// ---------------------------------------------------------------------------
//
// A port of the desktop's `getAutoRenameTarget`. New notes are born with a
// placeholder suffix (`-note-<uuid tail>`); once they hold enough text we
// rename them to `<original prefix>-<slug>.md`. A name the user (or a synced
// device) chose deliberately is never touched.
//
// The desktop consults the per-profile filename format; we key off the shape of
// the existing name instead, which gives the same answer in every case but one:
// a bare `<uuid>.md`. That shape means `uuid_v7` (never rename) or
// `uuid_v7_prefix_slug` (rename), and we cannot tell which from the name alone.
// We choose not to rename — leaving a deliberate-looking name alone is the
// recoverable mistake.

/// Minimum slug length before a rename is considered meaningful.
const MIN_SLUG_CONTENT_CHARS: usize = 8;

fn auto_rename_target(path: &str, content: &str) -> Option<String> {
    let file_name = path.rsplit('/').next().unwrap_or(path);
    let stem = file_name.strip_suffix(".md")?;

    // `slug_from_content` is the core's own Unicode-aware slugger — the same one
    // `allocate_note_file_name` uses at creation time, so names stay consistent.
    let slug = slug_from_content(content, "");
    if !has_enough_content(&slug) {
        return None;
    }

    let (prefix, suffix) = split_prefix_suffix(stem)?;
    if !is_provisional_suffix(suffix) {
        return None;
    }

    let next = format!("{prefix}-{slug}.md");
    if next.eq_ignore_ascii_case(file_name) {
        None
    } else {
        Some(next)
    }
}

/// Split a note stem into its generated prefix and the human-facing suffix.
///
/// Recognised prefixes are the UTC timestamp (`YYYY-MM-DDTHH-mm-ssZ`) and the
/// 13-character uuid-v7 head (`xxxxxxxx-xxxx`). Anything else is a name we did
/// not generate, so it is left alone.
fn split_prefix_suffix(stem: &str) -> Option<(&str, &str)> {
    if is_utc_timestamp_prefix(stem) {
        let (prefix, rest) = stem.split_at(20);
        return Some((prefix, rest.strip_prefix('-').unwrap_or("")));
    }
    if is_uuid_v7_full(stem) {
        // Bare uuid — ambiguous, see the module note above.
        return None;
    }
    if is_uuid_prefix(stem) {
        let (prefix, rest) = stem.split_at(13);
        return Some((prefix, rest.strip_prefix('-').unwrap_or("")));
    }
    None
}

/// `YYYY-MM-DDTHH-mm-ssZ` followed by end-of-stem or `-`.
fn is_utc_timestamp_prefix(stem: &str) -> bool {
    let bytes = stem.as_bytes();
    if bytes.len() < 20 {
        return false;
    }
    let digits = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18];
    let dashes = [4, 7, 13, 16];
    digits.iter().all(|&i| bytes[i].is_ascii_digit())
        && dashes.iter().all(|&i| bytes[i] == b'-')
        && bytes[10] == b'T'
        && bytes[19] == b'Z'
        && (bytes.len() == 20 || bytes[20] == b'-')
}

/// Full uuid-v7: `xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx`.
fn is_uuid_v7_full(stem: &str) -> bool {
    let bytes = stem.as_bytes();
    if bytes.len() != 36 || bytes[14] != b'7' {
        return false;
    }
    let dashes = [8, 13, 18, 23];
    bytes.iter().enumerate().all(|(i, &b)| {
        if dashes.contains(&i) {
            b == b'-'
        } else {
            b.is_ascii_hexdigit()
        }
    })
}

/// The 13-character uuid head `xxxxxxxx-xxxx`, followed by end-of-stem or `-`.
fn is_uuid_prefix(stem: &str) -> bool {
    let bytes = stem.as_bytes();
    if bytes.len() < 13 {
        return false;
    }
    (0..13).all(|i| if i == 8 { bytes[i] == b'-' } else { bytes[i].is_ascii_hexdigit() })
        && (bytes.len() == 13 || bytes[13] == b'-')
}

/// Slug length ignoring separators, matching the desktop's threshold.
fn has_enough_content(slug: &str) -> bool {
    slug.chars().filter(|&c| c != '-').count() >= MIN_SLUG_CONTENT_CHARS
}

/// A suffix is provisional while it is absent, a known placeholder, or too
/// short to be a real title — those are the names we are allowed to replace.
fn is_provisional_suffix(suffix: &str) -> bool {
    if suffix.is_empty() {
        return true;
    }
    let lower = suffix.to_ascii_lowercase();
    for stem in ["note", "untitled", "recording", "handwriting"] {
        if lower == stem {
            return true;
        }
        // `note-<uuid tail>` and friends, as produced at creation time.
        if let Some(tail) = lower.strip_prefix(stem).and_then(|s| s.strip_prefix('-')) {
            if tail.len() >= 8 && tail.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
                return true;
            }
        }
    }
    !has_enough_content(&lower)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BODY: &str = "Grocery list for the weekend";

    #[test]
    fn renames_timestamped_placeholder() {
        let target = auto_rename_target("Feed/2026-08-12T10-30-00Z-note-a1b2c3d4.md", BODY);
        assert_eq!(
            target.as_deref(),
            Some("2026-08-12T10-30-00Z-grocery-list-for-the-weekend.md")
        );
    }

    #[test]
    fn renames_bare_timestamp() {
        let target = auto_rename_target("Feed/2026-08-12T10-30-00Z.md", BODY);
        assert_eq!(
            target.as_deref(),
            Some("2026-08-12T10-30-00Z-grocery-list-for-the-weekend.md")
        );
    }

    #[test]
    fn keeps_deliberate_names() {
        // A suffix that already reads like a title must survive edits.
        assert!(auto_rename_target("Feed/2026-08-12T10-30-00Z-my-real-title.md", BODY).is_none());
        // A name we did not generate has no recognised prefix at all.
        assert!(auto_rename_target("Feed/shopping.md", BODY).is_none());
    }

    #[test]
    fn leaves_bare_uuid_alone() {
        // Ambiguous between uuid_v7 and uuid_v7_prefix_slug — see module note.
        assert!(
            auto_rename_target("Feed/0191e2a1-1b2c-7d3e-8f40-a1b2c3d4e5f6.md", BODY).is_none()
        );
    }

    #[test]
    fn renames_uuid_prefix_placeholder() {
        let target = auto_rename_target("Feed/0191e2a1-1b2c-note-a1b2c3d4.md", BODY);
        assert_eq!(
            target.as_deref(),
            Some("0191e2a1-1b2c-grocery-list-for-the-weekend.md")
        );
    }

    #[test]
    fn waits_for_enough_content() {
        // "Hi" slugs to something shorter than the threshold.
        assert!(auto_rename_target("Feed/2026-08-12T10-30-00Z-note-a1b2c3d4.md", "Hi").is_none());
    }
}
