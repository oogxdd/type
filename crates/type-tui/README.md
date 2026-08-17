# type-tui

A terminal shell for the Type notes app — the third shell over `type-core`,
alongside the Tauri desktop commands and the UniFFI mobile exports.

```
cargo run -p type-tui
```

Navigation is on the left and the editor on the right, with the note list either
in a panel of its own between them (the default) or nested inside the navigation
tree — `nav:toggle`, the terminal counterpart of the desktop's nested notes list.
The chrome is switchable: the default is a writing-focused hybrid with one
continuous header band, slim vertical rules that run into the rule above the
status line, and an open editor with vim-style line numbers. `ui:rails` drops
borders entirely and lets colour carry the structure, drawing the Feed as a
timeline. Two older experiments remain for comparison.

The navigation panel switches between the **Feed** (notes grouped by date —
Today / Yesterday / This week / Last week / Month → Week → Day, the same buckets
as the desktop app) and the **Folders** tree, whose first row is the open folder
itself. Vim-like keys, a shared `/` / Cmd+K command palette, a `:` command line,
background git sync, and live auto-preview are common to every layout: moving
`j`/`k` over notes shows each one's body before you commit to opening it.

The status line is one row and carries only what nothing else on screen shows:
the pane that has the keys, the last message, a pending vim count, `⟳ git` while
a sync runs, and the open root.

## Which folder it opens

**By default it opens the _dev_ app-data directory** (`com.digital.type2.dev`),
not your real notes. This is deliberate: the TUI runs the same note lifecycle as
the desktop app — it renames files to content slugs and deletes notes that become
empty — so pointing it at a real notes root by accident edits real content.

To use a real notes root, say so explicitly:

```sh
TYPE_TUI_APP_DATA_DIR="$HOME/.local/share/com.digital.type2" cargo run -p type-tui
```

**Or open any folder at all**, notes root or not:

```sh
cargo run -p type-tui -- ~/wiki      # or `:open ~/wiki` from inside
```

A folder opened this way is browsed as it is. Nothing is scaffolded into it —
no `Feed`, no `Archieve`, no `Recordings` — and with no `Feed` folder present
there is no Feed view to switch to: the left pane is the folder tree, the
opened folder is its root row, and notes sitting loose in that root are reached
by selecting it. `:open` with no argument goes back to the profile's notes
root. Git sync stays with the profile root and is declined while a folder is
open, since the remote, branch and SSH key all live in the profile.

Directly opened folders are treated as ordinary Markdown rather than Type
storage: source mode includes the complete file (including arbitrary YAML
frontmatter), rendered mode presents that source as a styled document, and a
save writes the raw Markdown back without injecting Type metadata. Type profile
roots keep their normal behavior: app frontmatter stays metadata and encrypted
bodies go through the shared core.

The open root is always shown either in the shared frame or the status line.

## Two panels or one

`nav:split` (the default) gives the note list a panel of its own: containers on
the left, the selected container's notes beside them, the editor on the right.
`nav:nested` collapses those two into a single rail — about a quarter of the
width — with each note drawn inside the folder, or in the Feed the date bucket,
it belongs to.
`nav:toggle` flips between them, and switching either way keeps your place: the
container you were in is opened so its notes are visible, and the cursor lands
back on whichever note was selected.

In the nested layout the navigation panel owns the notes, so the keys shift with
it: `Ctrl+W` has two stops instead of three, `Enter` opens the row under the
cursor (a note into the editor, a container open or shut) rather than hopping to
a note pane, `→` on a note opens it, and `o` creates a note in the folder the
cursor is inside.

## Trying the UI layouts

Independently of the above, `ui:next` (or `:ui`) cycles the chrome without
restarting:

- `ui:rails` — no borders anywhere. Each panel is marked by a vertical rail at
  its left edge (solid accent for the focused one, a hairline for the rest), tabs
  are set in small caps, and the Feed is drawn as the timeline it actually is:
  `●` an open bucket, `○` a shut one, `├`/`└` closing each note branch, and dates
  coloured by recency. Folders keep disclosure triangles — a folder is not a
  point in time. The floor under the status line is a heavier `━`.
- `ui:focus` — one continuous header band, light vertical rules that join the
  status rule below them, and an open padded editor surface. The default.
- `ui:frame` — one rounded parent container; the panels are borderless and
  separated by rules that span the container border to border. It closes itself,
  so there is no extra rule between it and the status line.
- `ui:panes` — independent rounded pane containers with no parent.

They all use exactly the same state and pane functions, and render both note
layouts. Choosing one later is a small default/removal change, not a rewrite,
and switching cannot touch notes.

## Keys

| | |
|---|---|
| `Ctrl+W` | move focus to the next pane — one press, one hop (two stops when nested) |
| `Ctrl+T` (`Cmd+T`, `Alt+T`) | hide / show the navigation, giving the editor the frame |
| `Tab` | in the navigation panel: switch between Feed and Folders |
| `j` / `k` | move down / up in any pane (the editor previews the note under the cursor) |
| `→` / `l` | in the tree: expand, then step into the first child, then hand over to the notes (nested: open the note); in the note list: open the note |
| `←` / `h` | in the tree: collapse, else jump out to the parent row; in the note list: back to the tree |
| `Enter` | open the folder / note; nested, on a container: open or shut it |
| `g` / `G` | jump to first / last |
| `o` | new note in the current folder (the note pane, or the tree when nested) |
| `m` | toggle editable Markdown source / rendered Markdown reader |
| `/` or `Ctrl+K` (`Cmd+K`) | open the searchable command palette |
| `:` | command line |

`Cmd` only reaches a terminal application through the kitty keyboard protocol
(Kitty, WezTerm, Ghostty); macOS Terminal.app and iTerm keep it for themselves,
which is why the Ctrl variants are the bindings to remember. `:panels` does the
same thing for a terminal that binds all three panel chords itself.

In the editor, normal mode supports `h j k l w b e 0 $ { }`, `gg` / `G`,
`i a I A o O`, `x`, `D`, `C`, `dd` `dw` `db` `d$` `d0`, `yy` `yw`, `p`, `u` /
`Ctrl+r`, `v` for visual mode, counts (`5j`, `3dd`), `search <pattern>` from the
palette with `n` / `N` for later matches, and `Ctrl+d` / `Ctrl+u` to scroll.
`Esc` in normal mode leaves the editor pane.

Deliberately absent: registers, marks, macros, text objects (`ciw`), `.` repeat.
Those need a real parser and are not what this app is for.

Rendered Markdown is read-only and styled in-process (headings, emphasis,
quotes, lists, links, code, tables, and YAML metadata in ordinary folders).
Use `j` / `k`, `Ctrl+d` / `Ctrl+u`, and `g` / `G` to scroll; `m` returns to
source, while `i` returns to source directly in insert mode.

## Commands

| | |
|---|---|
| `:w` `:q` `:q!` `:wq` | write / quit (`:q` flushes first, `:q!` does not) |
| `:new [folder]` | create a note and start typing |
| `:open [folder]` | browse any folder; without one, return to the notes root |
| `:feed` / `:folders` | switch the left panel to the Feed / folder tree |
| `:panels` | hide / show the navigation (the `Ctrl+T` toggle) |
| `nav:toggle` / `:nav` | move the note list into the tree, or back into its own panel |
| `nav:nested` / `nav:split` | switch directly to one note layout |
| `:view` / `:view:toggle` | toggle source / rendered Markdown |
| `:md` / `:view:markdown` | open rendered Markdown |
| `:source` / `:view:source` | return to editable source |
| `:ui` / `ui:next` | cycle the chrome experiments |
| `ui:rails` / `ui:focus` / `ui:frame` / `ui:panes` | switch directly to one layout |
| `:mv <folder>` | move the open note; `Tab` completes folders fuzzily |
| `mark:archive` / `mark:unarchive` | set or clear the open note's archived marker |
| `mark:reviewed` / `mark:unreviewed` | set or clear its reviewed marker |
| `search <pattern>` | search inside the open note; `n` / `N` repeat |
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

One more piece of policy lives in `main.rs`: **the event loop only repaints when
something changed.** It used to draw on every 50ms tick, and
`CrosstermBackend::draw` emits colour and attribute resets even when no cell
differs — so an idle app produced a steady stream of escape sequences, which
terminals read as a job doing work. That is what put a spinner on the iTerm2 tab
for as long as `type-tui` was open. An idle session now writes nothing at all;
key events, resizes, finished git work and the debounced save each mark the
screen dirty.

The other line this crate draws is around **folders it did not create**. The
core's `FilesystemNotesRepository::new` guarantees the system folders exist,
which is what a notes root wants; `::without_system_folders` (added for this
shell) skips that, which is what an opened folder wants. Creating a note in
such a folder still writes the usual `.notes-order.json` beside it — that is
the core's ordering file, and it is the only thing the app leaves behind.

The audio badge (`♪`) comes from front matter (`recording_audio_path`), so this
crate needs none of the recordings machinery — it builds `type-core` with
`default-features = false, features = ["git-sync"]`, which drops russh, tokio,
mDNS, reqwest and zip from the tree.

## Tests

```sh
cargo test -p type-tui        # parsing, completion, auto-rename, nesting, chrome
sh crates/type-tui/smoke.sh   # drives the real binary through a pty
sh crates/type-tui/smoke-sync.sh   # two devices over one bare repo
```

`src/test_support.rs` builds a throwaway folder and drives the real `App` over
it, which is how the nested-navigation and chrome-geometry tests assert against
actual rendered cells (`ratatui::backend::TestBackend`) rather than against
intentions. Note that a screen assertion is only reliable *there*: the pty smoke
test sees ratatui's diff output, which skips unchanged cells, so a literal string
can arrive fragmented — those steps assert behavior instead.

The smoke tests exist because the interesting bugs here are in the event loop and
the note lifecycle, which unit tests cannot reach — the `created_here` bug above
was found by `smoke.sh` and was invisible to `cargo test`.
