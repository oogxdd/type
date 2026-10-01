# Type GPUI demo

A standalone native UI experiment with GPUI Kit 0.7.0. It has its own Cargo
workspace and lockfile, so it does not change the desktop app or its dependencies.

From the repository root:

```sh
cargo run --manifest-path experiments/gpui-demo/Cargo.toml --locked
```

The first build downloads and compiles the native UI dependencies. On macOS,
full Xcode with the Metal tools is required. Windows needs the MSVC Rust
toolchain and Windows SDK; Linux needs the platform's graphics, font and
Wayland/X11 development libraries. See the [GPUI platform source](https://github.com/zed-industries/zed/tree/main/crates/gpui_platform)
and [GPUI Kit setup guide](https://gpui-kit.com/). The current demo has been
built and unit-tested on macOS. UI evaluation is left to the user;
Windows/Linux have not been validated here.

The window includes:

- A virtualized nested tree, four levels deep, with keyboard navigation,
  dropdown menus and drag/drop for both notes and folders. Drop in a folder
  row's middle to move inside it, near a row's upper/lower edge to reorder,
  or on the footer to move to the root. A folder cannot move into itself or
  a descendant. Folder moves carry their whole subtree. A single viewport hit
  test resolves the target; folders toggle on click rather than mouse-down.
  Hover inside a folder for 600 ms to expand it; holding near the viewport
  edges scrolls the tree. Escape cancels a drag. Selection and moves currently
  operate on one item; multi-selection is not implemented yet.
- One native text editor with line numbers, soft wrapping, selection, clipboard support and
  undo/redo. Each visited note retains its editor buffer, cursor and history
  during the session. Markdown syntax highlighting is enabled in the editable
  buffer; markup remains visible. This is not a WYSIWYG Markdown renderer.
- A switchable Vim layer, enabled by default, with a visible mode indicator.
  Insert mode uses the native input/IME path. Normal and Visual modes gate
  native text entry, while modal edits use the same editor history.
- Visible Type-style tag syntax with colored regions: leading `#todo` on a
  paragraph, and `::: #idea` / closing `:::` around multiple lines. Nested
  blocks can use longer outer fences (`::::`). The Tag line / Tag block menus
  apply a sample tag to the cursor's line or selected lines; names can be edited
  directly. Regions refresh after a 120 ms typing pause and track edits meanwhile.
- Frontmatter stays outside the editor buffer and is preserved verbatim.
  A row's Copy .md with frontmatter action copies the full synthetic file,
  including its header. Duplicates get a fresh sample id.
- Resizable panes, Russian/English sample text, a document of about 1,800 lines,
  and a collapsed folder of 1,000 generated notes. Editor states are created
  only when notes are first opened.

All data is synthetic and held in memory. The demo does not open a notes root,
connect to `type-core`, use Tauri or invoke IPC. Closing the window discards
changes. The copy menu explicitly writes the chosen sample file to the clipboard.

This is a prototype of the simpler text-and-tags approach, with the tag syntax
visible as requested. The presentation parser supports hashtag names, leading
paragraph tags and nested fenced scopes, including an unclosed scope through EOF.
It ignores tag-looking syntax in code fences. It does not yet implement flags
(`key=value`), inline TagSpan syntax, registry colors or the complete shared
Markdown document model. It must not be used as a privacy filter or to migrate
real notes. Persistence, sync and recording are outside this sample.

The entry point is `src/main.rs`; synthetic fixtures are in `src/sample_data.rs`
and `samples/welcome.md`. `document.rs` handles metadata separation and tag
regions; `tree_moves.rs` handles tree mutations; `vim.rs` contains the modal
command state machine and UTF-8 motions. Dependencies are pinned by
`Cargo.toml` and `Cargo.lock`.

Validation:

```sh
cargo fmt --manifest-path experiments/gpui-demo/Cargo.toml --check
cargo build --manifest-path experiments/gpui-demo/Cargo.toml --locked
cargo test --manifest-path experiments/gpui-demo/Cargo.toml --locked
```

Vim command coverage:

- `i/a/I/A`, `o/O`, Escape and Ctrl-[; `h/j/k/l`, arrows, `w/b/e`, `0/^/$`, `gg/G`.
- `d/c/y` with motions and counts, `dd/cc/yy`, `D/C/x`, `p/P`, `r`, `f/t`.
- `v/V`, `iw/aw` and basic quoted/bracketed text objects; `u`, Ctrl-r; `/` opens
  the editor's native search panel. The unnamed register is shared across notes.
- `j/k` use the editor's wrapped visual rows. Linewise operators and `V` use
  logical lines. Character motions use Unicode scalar boundaries, not extended
  grapheme clusters. Quoted/bracketed text objects currently have a simple,
  non-nesting parser. Dot repeat, macros, named/system registers, Ex commands,
  backward character search and full Vim search semantics are not implemented.

Validation for the DnD/Vim checkpoint: macOS build and 23 unit tests passed.
Native UI gesture verification remains pending: Computer Use access to the demo
was not approved. Tests cover tree mutation invariants and modal command effects,
not native event dispatch, IME, focus, or drag timing.

Feasibility: GPUI Kit's [Editor](https://gpui-kit.com/docs/components/editor)
provides the text engine and decoration hooks. Styling editable Markdown is a
reasonable incremental path. Obsidian-style live preview with hidden delimiters,
variable-height headings, embedded images and tables needs an additional display
mapping/layout layer; enabling Markdown highlighting alone does not provide it.
