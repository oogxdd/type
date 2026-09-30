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
  a descendant. Folder moves carry their whole subtree. There is no automatic
  scrolling or expansion while hovering during a drag yet.
- One native text editor with soft wrapping, selection, clipboard support and
  undo/redo. Each visited note retains its editor buffer, cursor and history
  during the session. There is no preview pane or Markdown formatting renderer.
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
real notes. Persistence, sync, recording and Vim mode are outside this sample.

The entry point is `src/main.rs`; synthetic fixtures are in `src/sample_data.rs`
and `samples/welcome.md`. `document.rs` handles metadata separation and tag
regions; `tree_moves.rs` handles tree mutations. Dependencies are pinned by
`Cargo.toml` and `Cargo.lock`.

Validation:

```sh
cargo fmt --manifest-path experiments/gpui-demo/Cargo.toml --check
cargo build --manifest-path experiments/gpui-demo/Cargo.toml --locked
cargo test --manifest-path experiments/gpui-demo/Cargo.toml --locked
```
