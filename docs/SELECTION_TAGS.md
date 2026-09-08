# Tags on selected text

On desktop, select text in the normal editor or across notes in multi-note
review, then choose **Cmd+K / Ctrl+K → Selection → Assign tag…**. The picker
reuses tags found in the active working folder, or creates a name with a preset
or custom color. Each affected paragraph, heading, list-item paragraph, or code
block receives a light background and colored top/bottom borders. Wrapped visual
lines and explicit line breaks inside one paragraph belong to the same block.
Hovering shows the tag names. Multiple tags can coexist on a block; their colors
share the background. Changing the color when assigning an existing tag affects
only that selection, not every occurrence of the tag.

Multi-note review leaves note bodies intact and writes only frontmatter. In the
normal editor, tags are ProseMirror node attributes: typing inside a block,
inserting paragraphs above it, splitting it, and Undo/Redo preserve the tag
through the editor's existing document history and autosave. Deleting a block
removes its tag; Undo restores both. Pasting text does not import its tags.

## Storage and matching

`packages/shared/src/selection-tags.ts` owns the versioned wire format, validation,
and matching. `type_selection_tags` is a single JSON object on a frontmatter line
(JSON is valid YAML flow syntax), so the Rust core's existing passthrough field
handling preserves it across desktop/mobile writes and sync. It contains
`version: 1` and a `blocks` array. Each entry carries:

- `tags`: `{ name, color }` objects; colors are six-digit hex values.
- `index`: zero-based text-block ordinal, not a Markdown source line number.
- `hash`, `before`, `after`: fingerprints of the rendered block and its neighbors.
- `document`: a fingerprint of the ordered block fingerprints.

No excerpt of the selected text is copied into the header. Fingerprints are
non-cryptographic matching hints; frontmatter (including tag names) remains
plaintext under the app's existing body-only encryption contract.

When a note is reopened, an unchanged document uses the exact block ordinal.
Otherwise a unique text fingerprint follows the block even if preceding lines
were inserted or deleted, or the block moved. Repeated text uses neighboring
fingerprints. If external editing changes the tagged text itself, or duplicate
blocks cannot be distinguished safely, the entry remains in frontmatter but has
no highlight. The app does not guess a replacement location. Editing that text
inside the desktop editor updates its fingerprints automatically.

The desktop implementation lives in `features/selection-tags`. The palette
captures selection before its focus trap opens, via the registered editable and
read-only note surfaces. Review assignments reread each source note and resolve
anchors before writing, retain unrelated metadata, and report partial failures.
A retry skips notes already saved. The tag catalog is derived from the current
working folder with bounded concurrent reads, and is not persisted separately.

Mobile has no tag-editing/highlight UI yet. Its existing frontmatter passthrough
retains the metadata; text changed on mobile uses the external-edit matching
rules when the desktop opens it again.

## Validation

Shared tests cover relocation, duplicate ambiguity, metadata roundtrips and
validation. Desktop tests cover editor insertions, in-block edits, splitting,
deletion, Undo/Redo and restoring metadata without adding history steps. Browser
verification uses mocked Tauri IPC with the real providers, command palette,
editor and review components; it exercises single-note creation, cross-note
assignment, catalog reuse, persistence, and switching back to the editor.
