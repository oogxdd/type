# type-tui

A terminal shell for the Type notes app — the third shell over `type-core`,
alongside the Tauri desktop commands and the UniFFI mobile exports.

```
cargo run -p type-tui
```

Three areas divided by thin rules: navigation on the left, the note list in
the middle, the editor on the right. The left panel switches between the
**Feed** (notes grouped by date — Today / Yesterday / This week / Last week /
Month → Week → Day, the same buckets as the desktop app) and the **Folders**
tree. Vim-like keys, a `:` command line, git sync, and live auto-preview:
moving `j`/`k` in the note list shows each note's body in the editor as you
scroll, before you commit to opening it.

## Which notes root it opens

**By default it opens the _dev_ app-data directory** (`com.digital.type2.dev`),
not your real notes. This is deliberate: the TUI runs the same note lifecycle as
the desktop app — it renames files to content slugs and deletes notes that become
empty — so pointing it at a real notes root by accident edits real content.

To use a real notes root, say so explicitly:

```sh
TYPE_TUI_APP_DATA_DIR="$HOME/.local/share/com.digital.type2" cargo run -p type-tui
```

The left pane header always shows which root is open.

## Keys

| | |
|---|---|
| `Ctrl+W` then `h` / `l` | move focus between panes (`Ctrl+W Ctrl+W` cycles) |
| `Tab` | in the left panel: switch between Feed and Folders |
| `j` / `k` | move down / up in any pane (the editor previews the note under the list cursor) |
| `l` / `h` | in the tree: expand / collapse; in the list: open the note |
| `Enter` | open the folder / note (focus the editor) |
| `g` / `G` | jump to first / last |
| `o` | new note in the current folder (list pane) |
| `:` | command line |

In the editor, normal mode supports `h j k l w b e 0 $ { }`, `gg` / `G`,
`i a I A o O`, `x`, `D`, `C`, `dd` `dw` `db` `d$` `d0`, `yy` `yw`, `p`, `u` /
`Ctrl+r`, `v` for visual mode, counts (`5j`, `3dd`), `/pattern` with `n` / `N`,
and `Ctrl+d` / `Ctrl+u` to scroll. `Esc` in normal mode leaves the editor pane.

Deliberately absent: registers, marks, macros, text objects (`ciw`), `.` repeat.
Those need a real parser and are not what this app is for.

## Commands

| | |
|---|---|
| `:w` `:q` `:q!` `:wq` | write / quit (`:q` flushes first, `:q!` does not) |
| `:new [folder]` | create a note and start typing |
| `:feed` / `:folders` | switch the left panel to the Feed / folder tree |
| `:mv <folder>` | move the open note; `Tab` completes folders fuzzily |
| `:d` | delete the open note |
| `:connect <url> [branch]` | point this notes root at a git remote |
| `:sync` | pull, then push |
| `:pull` `:push` `:status` | the individual git operations |
| `:key` | show the app-managed SSH public key, generating it if absent |
| `:h` | key reminder in the status bar |

### Two sharp edges in git sync

Both come from the core / libgit2, not from this shell:

* **Connecting to a completely empty remote fails** with `corrupted loose
  reference file: FETCH_HEAD`. Give the remote at least one commit first.
* **`:push` straight after `:connect` is rejected** as non-fast-forwardable.
  That is correct: the core commits this device's existing notes as their own
  history so nothing is lost, which means the local branch is not a descendant
  of the remote yet. Use `:sync`, which pulls (and merges) before pushing.

### Git sync runs in the background

`:sync`, `:pull`, `:push` and `:connect` execute on a background thread (tokio
`spawn_blocking`), so a slow remote never freezes the UI: the status line shows
`⟳ git…` while one is in flight, and the result is applied when it lands. The
editor buffer is flushed before the task starts and reloaded after a pull
(kept untouched if you typed during the sync). One git operation runs at a
time; `:q` waits for it to finish, `:q!` quits immediately. See `ASYNC.md` for
a walkthrough of the whole path.

## What this crate owns, and what it does not

`type-core` supplies the entire backend. Building the notes service is six lines
(`src/core.rs`) — the same wiring `type-ffi` uses — and every note operation is a
direct, typed call into `application::notes`.

What is *not* in the core, and therefore lives here, is the editor **policy**,
ported from the desktop's `use-note-editor.ts` and `note-autoname.ts`:

* writes are debounced 400ms;
* a note whose body becomes empty is deleted when we flush it;
* a note is renamed to a content slug while its file name is still provisional.

One case the desktop does not have: `:new` creates the file eagerly, where the
desktop creates lazily on the first keystroke. `Editor::created_here` is how an
abandoned new note still gets cleaned up. See the comments in `src/editor.rs`.

The audio badge (`♪`) comes from front matter (`recording_audio_path`), so this
crate needs none of the recordings machinery — it builds `type-core` with
`default-features = false, features = ["git-sync"]`, which drops russh, tokio,
mDNS, reqwest and zip from the tree.

## Tests

```sh
cargo test -p type-tui        # command parsing, folder completion, auto-rename
sh crates/type-tui/smoke.sh   # drives the real binary through a pty
sh crates/type-tui/smoke-sync.sh   # two devices over one bare repo
```

The smoke tests exist because the interesting bugs here are in the event loop and
the note lifecycle, which unit tests cannot reach — the `created_here` bug above
was found by `smoke.sh` and was invisible to `cargo test`.
