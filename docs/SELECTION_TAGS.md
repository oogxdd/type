# Tags in note bodies

Select text, then **Cmd+K / Ctrl+K → Selection → Assign tag…**. Vim `v` and `V`
work through the same captured ProseMirror selection. A phrase receives a `TagSpan`
mark; a whole block or several blocks receive one `TagBlock` wrapper. Each range
has a frame and a badge listing its names and flags. Overlapping spans split at
their boundaries and keep the union of names. Assignment is its own Undo step.

## Storage

```markdown
#todo позвонить в банк

::: #urgent researched=true
## Heading

Several paragraphs, lists, quotes or code blocks.
:::

A [short phrase]{#component number=42} inside a paragraph.
```

The shared attribute grammar lives in `packages/shared/src/tags.ts`, so previews
can use it without depending on DOM code. Names start with a Unicode letter or
number, then accept letters, numbers, `_./-`, up to 80 characters. Escaped `\_`
from older Turndown output is accepted. Tags are whitespace separated; flags use
`key=value` or `key="quoted value"` with escaped quotes/backslashes. Flags are
parsed, displayed and saved; their editing UI is deferred.

A leading run tags the block; a mid-line hashtag is prose. `#fff` and `#123` at
the start of a block are tags when followed by content. `# Heading` remains an
ATX heading. Code fences are parsed before their contents can become tags.

Container fences contain at least three colons, with an exact-length closing
fence alone on its line. Outer fences are longer than nested fences. A one-paragraph
container with names only is serialized as a leading run. An unterminated
container consumes the rest of the body and is first saved with an explicit closing
fence; subsequent saves can canonicalize that repaired one-paragraph container.
No existing text is moved outside its scope during repair. Normal Markdown
canonicalization (emphasis, lists, hard breaks and extra blank paragraphs) still applies.

There are no anchors, fingerprints or unresolved tags. Editing text externally
keeps its tag because the delimiters stay with the text. Copying and pasting tagged
HTML carries names and flags. Enter at the end of a container exits it; Backspace
at its start unwraps it. The multi-note editor assigns through the same live editor as the single-note view,
checks the captured document before applying, and saves only that note. The optional
read-only lens reserializes Markdown on assignment; its body is not byte-preserved.

Note-wide names are separate metadata: `tags: [todo, urgent]` in the actual
frontmatter. `update_note_tags` updates these through Rust, preserving the body
and encryption, rather than prepending frontmatter to the body returned by read_note.

## Registry and colors

`<notes_root>/.type/tags.json` is a synced, version-1 registry:

```json
{"version":1,"tags":[{"name":"skip-ai","color":"#8b5cf6","description":""}]}
```

Settings → Tags adds, edits, recolors and deletes registry entries. Colors are
six-digit hex, resolved by a ProseMirror decoration plugin. Recoloring changes
all open occurrences without changing Markdown. Multiple names use equal color
bands. Renaming/deleting changes the registry only: existing names in notes remain
and unknown names use `DEFAULT_TAG_COLOR`. The assignment dialog reads the registry
and names in open documents; it does not scan every note. The provider resets by
working-folder root and reloads on focus or preview invalidation.

Mobile stores the same Markdown and has Rust/UniFFI registry and note-tag APIs.
It does not yet have tag highlighting or a registry editor. Preserve delimiters
when editing there; deleting a privacy delimiter can change what MCP exposes.

## Verification

`npm test` covers grammar, parsing/serialization, ten reloads, nested scopes,
Unicode, code/lists, overlap, paste, history and real Vim selection capture.
`cargo test --workspace --lib` covers frontmatter and registry persistence.
`npm run mcp:build && npm run mcp:test` and `node scripts/test-notes-mcp.mjs`
exercise the shared privacy projection and real stdio canaries. See
[AI_NOTES_MCP.md](AI_NOTES_MCP.md) for the manual privacy check.
