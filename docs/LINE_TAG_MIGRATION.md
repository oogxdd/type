# Decision: body-inline tags replace frontmatter anchors

The proposed v2 line-range migration was dropped. Line ranges still separate a
tag from its text and require a Markdown source map absent from the current
marked/Turndown pipeline. Instead, tags are stored with the text: `::: #tag`
containers, `[text]{#tag}` spans and leading `#tag` runs. See
[SELECTION_TAGS.md](SELECTION_TAGS.md) for the implemented grammar and editor behavior.

The v1 `type_selection_tags` anchor reader, writer, fingerprints and restoration
logic have been removed outright. The corpus audit supplied with this change found
only two throwaway notes in the `123fresh` profile and no tagged production corpus
to migrate. There is no automatic migration or fallback resolver.

The former frontend frontmatter write path also nested metadata inside the body:
Rust `read_note` strips the true header, while `write_note` preserves that header
and treats its content argument as body. Body tags therefore round-trip directly;
note-wide `tags` use a dedicated metadata command in Rust.

The MCP privacy contract deliberately changes: leading hashtags and containers
are tags, mid-line hashtags are prose. Unclosed containers extend through EOF;
malformed opening attributes withhold the note. The shared schema and
`apps/notes-mcp/src/projection.ts` are the boundary for future format changes.
