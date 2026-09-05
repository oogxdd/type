# Vim mode in the note editor

The desktop note editor is modal. It is not a Vim emulator — it is a Vim-shaped
editing layer over a Tiptap/ProseMirror rich-text document, covering the keys
people actually reach for while writing prose.

Code lives in `apps/desktop/src/features/notes/editor/`:

| File | Role |
|------|------|
| `lib/vim/text-motions.ts` | Pure motions and text objects over a flat string. No editor dependency. |
| `lib/vim/keys.ts` | The keyboard grammar: counts, registers, operators, motions, objects, actions. A pure reducer. |
| `lib/vim/flat-doc.ts` | Projects a ProseMirror document onto Vim's "buffer of lines" model, with a two-way index ↔ position mapping. |
| `lib/vim/commands.ts` | Executes a parsed command against an `EditorView`. |
| `lib/vim/registers.ts` | Session-lifetime registers (text + the yanked ProseMirror slice). |
| `lib/vim/vertical-motion.ts` | Geometry for `j`/`k` (visual lines, wrapped text). |
| `lib/vim/key-event.ts` | Layout-independent key normalisation. |
| `hooks/use-vim.ts` | Mode state, the pending-key buffer, the block cursor, and the `VimHost` that reaches Tiptap and the layout. |

The first three are covered by co-located unit tests; `commands.test.ts` drives
real key sequences (`"3dd"`, `"ci("`, `"vjd"`) against a real `EditorState` with
geometry stubbed, so it exercises the parser and the executor together.

## Supported keys

### Modes

| Key | Effect |
|-----|--------|
| `i` `a` `I` `A` | Insert before / after the cursor, at first non-blank / end of line |
| `o` `O` | Open a line below / above (continues a list, like Enter does) |
| `v` `V` | Charwise / linewise Visual; pressing the same key again leaves Visual |
| `gv` | Reselect the previous Visual range |
| `o` (in Visual) | Swap which end of the selection moves |
| `Esc` | Back to Normal (from Insert it steps one character left, as Vim does) |

Clicking in the text enters Insert mode — that is deliberate, so the mouse still
behaves like an ordinary editor.

### Motions

`h` `j` `k` `l`, arrows, `Space`, `Backspace` ·
`w` `W` `b` `B` `e` `E` `ge` `gE` ·
`0` `^` `$` `g_` ·
`gg` `G` `{count}gg` `{count}G` ·
`f{c}` `F{c}` `t{c}` `T{c}` `;` `,` ·
`{` `}` · `%` ·
`Ctrl-d` `Ctrl-u` (half page) · `Ctrl-j` `Ctrl-k` (ten lines) ·
`zz` `zt` `zb` (scroll the cursor to centre / top / bottom)

### Operators

`d` `c` `y`, `>` `<` (list indent/outdent), `gu` `gU` `g~`.

Each takes a motion (`dw`, `d$`, `c%`), a text object (`diw`, `ca(`), or itself
for the whole line (`dd`, `cc`, `yy`, `>>`, `guu`). Counts work on both sides:
`2d3w` deletes six words.

### Text objects

`iw` `aw` `iW` `aW` · `ip` `ap` · `i"` `a"` `i'` `a'` `` i` `` `` a` `` ·
`i(` `a(` `ib` `ab` · `i[` `a[` · `i{` `a{` `iB` `aB` · `i<` `a<`

In Visual mode a bare text object extends the selection over it (`viw`).

### Edits

| Key | Effect |
|-----|--------|
| `x` `X` | Delete character forward / backward (never across the line break) |
| `s` `S` | Substitute character / line |
| `D` `C` `Y` | Delete / change to end of line, yank line |
| `p` `P` | Paste after / before, charwise or linewise depending on the yank |
| `r{c}` | Replace the character (with a count, several of them) |
| `J` | Join the next line with a space |
| `~` | Toggle case and move on |
| `u` `Ctrl-r` | Undo / redo |
| `.` | Repeat the last change |
| `"{a-z0-9}` | Prefix any yank, delete or paste with a register; `"_` is the black hole |

In Visual mode: `d`/`x`, `c`/`s`, `y`, `p`, `u`/`U`/`~`, `>`/`<` and `r{c}` all
act on the selection.

## Design decisions

**`j`/`k` move by visual line, everything else by logical line.** A note is
mostly long wrapped paragraphs, and one paragraph is one logical line. Moving
`j` a whole paragraph at a time would be useless, so vertical *navigation* uses
layout geometry (`vertical-motion.ts`) — effectively Vim's `gj`/`gk`. Everything
linewise (`dd`, `V`, `dj`, `yy`, `cc`) still operates on logical lines, so `dd`
deletes the paragraph you are standing in. This is the one place the
implementation knowingly departs from Vim, and it is the right trade for prose.

**Commands are parsed before they are executed.** `keys.ts` never touches the
document; it turns keystrokes into a `VimCommand` value. That is what makes
`2d3w`, `"ayy` and `ci(` testable without a DOM, and it keeps the grammar in one
readable place instead of scattered through a key handler.

**The document is projected, not converted.** `flat-doc.ts` builds a flat string
whose every character index maps to a ProseMirror position (and back), so the
pure motions can drive a rich-text tree. Hard breaks split a block into several
lines; inline leaves (images) occupy exactly one column, which keeps offsets and
positions aligned. Non-textblock leaves (horizontal rules) contribute no line, so
motions step over them.

**Registers keep the slice, not just the text.** Yanking a bullet list and
pasting it gives back a bullet list. Only when the yank spans hard-break lines
does it fall back to plain text.

**Keys are normalised to the US layout, characters are not.** `dd` has to work on
a Cyrillic layout, so command keys come from `event.code`. But `f{c}` and `r{c}`
have to follow the layout, so those read `event.key`. `key-event.ts` returns both.

**Visual mode tracks its own head.** Charwise Visual selects the character *under*
the cursor, so the ProseMirror selection head sits one position past it. Reading
the cursor back from the selection would drift by one on every keypress — this
was a real bug, caught by `commands.test.ts`. `VimHost.visualHead` is the
authoritative cursor while Visual is active.

**Undo groups per Insert session.** Entering and leaving Insert calls
`closeHistory`, so `u` undoes a whole typed phrase rather than one keystroke's
worth of ProseMirror history grouping.

## Not implemented

Search (`/`, `?`, `n`, `N`), marks (`m`, `` ` ``), macros (`q`, `@`), ex commands
(`:`), blockwise Visual (`Ctrl-v`), sentence objects (`is`/`as`), tag objects
(`it`/`at`), `H`/`M`/`L`, and jump lists. `.` replays the command and, for a
change that entered Insert mode, the text that was typed — provided the typing
stayed inside one block.

## Where to change things

- **A new motion**: add it to `VimMotion` and the `MOTIONS` table in `keys.ts`,
  classify it in `isLinewiseMotion`/`isInclusiveMotion`, then resolve it in
  `resolveMotion` in `commands.ts`. If it is text-only, the actual logic belongs
  in `text-motions.ts` with a test.
- **A new text object**: extend `resolveTextObject` in `keys.ts` and
  `textObjectRange` in `commands.ts`.
- **A new action**: add it to `VimAction` and the `actions` table, then handle it
  in `executeAction`.
- **Anything needing layout or Tiptap**: add it to `VimHost` and implement it in
  `use-vim.ts` — `commands.ts` must stay free of React and of the editor instance.
