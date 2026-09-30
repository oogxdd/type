# Native editor keys

The GPUI editor uses UTF-8 byte ranges and a small modal layer, not full Vim.
Implementation: `apps/gpui/src/vim.rs`; dispatch: `commands.rs`/`main.rs`;
cursor paint: `cursor.rs`.

| Mode | Cursor / input |
| --- | --- |
| Insert | Thin native blinking caret; text and IME belong to the editor |
| Normal | Translucent glyph-sized block; native mutations blocked |
| Visual / Visual line | Blue block plus selection; native mutations blocked |

Keys implemented include i/a/I/A, o/O, Escape/Ctrl+[, hjkl/arrows, w/b/e,
0/^/$, gg/G, counts, f/t, r, x, d/c/y, D/C, text objects, v/V, p/P, u,
Ctrl+R and `/` search. This is a subset; named registers/macros and full
rich-text editing are not provided. See the code/tests for exact grammar.

j/k move through rendered rows so wrapped prose remains navigable; linewise
operators use logical lines. Visual includes the character under the cursor:
`Vim.head` is authoritative, not the native selection endpoint. Command keys use
GPUI's normalized key while literal targets retain the typed character.

Ctrl+W switches navigation/editor without resetting the mode. Tab in navigation
cycles Stream/Folders; in Insert it belongs to the editor. Global chords have one
owner and intercept before Kit's built-in actions. See
[desktop README](../apps/gpui/README.md) for application shortcuts.

Larger H1/H2/H3 were investigated, not implemented. Stock Kit Editor 0.7 uses
uniform font size/line height; text decorations have no per-range size. A proper
implementation needs layout/hit-testing/selection/scroll extensions. See
[Editor API](https://gpui-kit.com/component/editor/).
