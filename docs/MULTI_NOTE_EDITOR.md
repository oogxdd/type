# Editing selected notes together

Selecting multiple notes opens the ordinary editor on all their bodies in middle-pane order.
Thin, non-editable inset date/time dividers mark file boundaries. There is one scroll container
and one set of editor controls. In a multi-note selection, the first note also shows its date.
Clicking a note selection focuses the first note in Normal mode and resets the scroll to the top.
In a multi-note selection, gg returns to the first note; reaching its first visual line also
reveals the date divider. Audio notes use a compact play/pause control beside the date, with
elapsed/total time while playing; audio resolves only when requested. Feed month/week/day context
menus select every note below that group, including collapsed descendants. Each note has its own Tiptap document and Undo/Redo history;
a viewport window mounts at most 12 editor views, admitting one new view per animation frame.
The active note stays mounted even offscreen, preserving focus, IME composition and tag-dialog
selections. Other views are parked with their original Tiptap instance/schema/document/history;
returning to a note remounts its view without losing Undo/Redo. Measured spacers preserve layout.
Preview updates and individual document saves do not re-render all the other editors. Preview refreshes retain the open selection order. Initial focus belongs to the
group and is cancelled by manual interaction; late-loading children never reclaim it. The
visible note anchors the viewport when preceding placeholders grow during loading.

Bare j/k (including counts), Up/Down, and Ctrl+D/U half-page motions cross boundaries while retaining the mode and desired
column. Visual mode, Shift selections, mouse selections, text operators and Select All stay
within their starting note. Backspace/Delete cannot join files. Dragging text within a note
works; dragging across a file boundary is blocked. Other Vim motions retain their existing
note-local behavior. When a motion reaches an unmounted/loading note, it prioritizes that note
and resumes the remaining motion once ready. New user input cancels that deferred jump.
Failed notes stop navigation until retried.

Cmd+K captures the live editor selection before moving focus. Assign tag uses the same
Markdown TagBlock/TagSpan implementation and color registry as the single editor. All content
changes, including tags, flow through the file's own session entry. No new tag format or
metadata migration is introduced. The editor bridge includes the focused file path so
caret-based commands such as Split note use that note, rather than the feed's selection anchor.

`DocumentSession` belongs to one profile/root and keeps per-path content, loading, dirty,
saving and error states. A three-worker read queue prioritizes visible/navigation targets and
cancels queued reads outside the new selection. All selected Markdown can prefetch progressively,
but only the viewport is parsed into editor DOM. Finalization reads have a separate two-worker
limit, and unchanged notes that need no finalization skip rereading. Autosave debounces for 400 ms and serializes writes per path. Flush
waits for the latest edits to every open/retained document and is used by profile/background
workflows and file moves, renames and deletions. Own preview notifications do not reload an
editor, and late reads cannot replace newer edits. External refreshes update clean documents;
concurrent disk editing while a document is dirty is not a collaborative merge protocol.

Removing a note from the selected set flushes it and applies the existing empty-note and
provisional-filename policies. Merely moving the cursor does not trigger those policies.
Failed writes retain their in-memory draft, even after navigation, with Retry save / Open draft.
This is not crash recovery: drafts are not persisted separately from the note file.

Validation covers independent writes, write ordering, stale reads, failed-save retry, profile
isolation, selection boundaries, counts, empty notes, Markdown tags, and editor retention.
Browser checks use fixture notes and mocked Tauri IPC, never production notes.

The 150-note browser fixture verifies editing before background loading completes, a maximum
of three concurrent reads and twelve mounted views, parking/restoring notes with Undo/Redo,
counted navigation across lazy boundaries, and gg. This bounds multi-note overhead; an unusually
large individual note can still take time to parse/render, as in the ordinary editor.
