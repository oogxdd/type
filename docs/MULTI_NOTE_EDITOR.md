# Editing selected notes together

Selecting multiple notes opens the ordinary editor on all their bodies in middle-pane order.
Thin, non-editable full-width date/time dividers mark file boundaries. There is one scroll container
and one set of editor controls. Each note has its own Tiptap document and Undo/Redo history;
remaining editors stay mounted when the selection grows or shrinks, including the transition
to one note.

Bare j/k (including counts), Up/Down, and Ctrl+D/U half-page motions cross boundaries while retaining the mode and desired
column. Visual mode, Shift selections, mouse selections, text operators and Select All stay
within their starting note. Backspace/Delete cannot join files. Dragging text within a note
works; dragging across a file boundary is blocked. Other Vim motions retain their existing
note-local behavior. A failed/loading note is a navigation boundary until it loads.

Cmd+K captures the live editor selection before moving focus. Assign tag uses the same
Markdown TagBlock/TagSpan implementation and color registry as the single editor. All content
changes, including tags, flow through the file's own session entry. No new tag format or
metadata migration is introduced. The editor bridge includes the focused file path so
caret-based commands such as Split note use that note, rather than the feed's selection anchor.

`DocumentSession` belongs to one profile/root and keeps per-path content, loading, dirty,
saving and error states. Autosave debounces for 400 ms and serializes writes per path. Flush
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
