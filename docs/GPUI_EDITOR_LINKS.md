# GPUI editor links: detection and Cmd-click

Status: editor links open with Cmd-click. Listing hover previews and their
setting were removed from the working branch at the user's request. The
experiment is preserved on `experiment/gpui-link-previews` at `5570bf5`.
Kit version: `gpui-kit =0.7.0` (`gpui-base` and `gpui-component` 0.7.0).

## Pipeline

| Step | Owner |
| --- | --- |
| Find `http(s)` ranges | `type_gpui::document::link_ranges` (`apps/gpui/src/document.rs`) |
| Color them | `editor::color_links`, one `TextDecorationCollection` per editor |
| Cmd-hover underline | `editor::LinkUnderlines` (app-owned decoration collection) |
| Cmd-click opens the browser | `capture_any_mouse_down` on `editor-pane` |
| Unscrolled fallback (engine path) | `editor::LinkTargets` (`DefinitionProvider`) |

`link_ranges` accepts bare `https://…`, `<autolinks>` and `[label](url)`
targets. A candidate needs a non-alphanumeric character before `http`, at least
one alphanumeric byte after the scheme, and loses trailing sentence punctuation
and unbalanced `()[]{}`. `link_uri` percent-escapes non-ASCII bytes so Cyrillic
paths survive `lsp_types::Uri` parsing.

## Root cause: the engine rejects pointers below the scroll offset

`gpui-base` `InputBaseState::on_mouse_move`
(`gpui-base-0.7.0/src/input/base/state.rs:2402`) starts with:

```rust
let within_bounds = self.last_bounds
    .as_ref()
    .map(|bounds| bounds.contains(&event.position))
    .unwrap_or(false);
if !within_bounds {
    M::clear_hover_state(self, cx);
    return;
}
```

`last_bounds` is assigned in prepaint from the element's paint bounds
(`base/element.rs:3188`), and the engine translates those bounds by the scroll
offset. Measured on the maintainer's 400-line listing note in a 1150×780
window (`text_bounds()` vs `input_bounds()`):

| Scroll | `text_bounds` (paint) | `input_bounds` (viewport) | Hover works for |
| --- | --- | --- | --- |
| `0` | `(376, 36) 764×736` | `(376, 36) 764×736` | `y = 36…772` |
| `-468` | `(376, -432) 764×736` | `(376, 36) 764×736` | `y = 36…304` |

So after scrolling, only the top `height - scroll` strip of the editor reaches
`M::on_mouse_move`. Everything below it is treated as "pointer left the input"
and the hover state is cleared.

Consequences:

- `handle_hover_definition` (`editor/lsp/definitions.rs:59`) is never called, so
  the link is not underlined and `hover_definition` stays empty.
- `handle_click_hover_definition` (`definitions.rs:139`) requires a non-empty
  `hover_definition` matching the click offset, so **Cmd-click silently does
  nothing**.
- `handle_hover_popover` (`editor/lsp/hover.rs:88`) is skipped too, so listing
  previews do not open.
- Plain clicks still work: `on_mouse_down` does no bounds check, so the caret
  lands on the correct offset. That is why the failure looks like "the link is
  there but Cmd does nothing".

Symptom shape reported by the maintainer: *only the links in the first viewport
respond to Cmd-hover/Cmd-click*. The first two links of the note sat above the
fold; the third needed scrolling.

Reproduction: open any note longer than the viewport, scroll, Cmd-hover a link
below `input_bounds.top() + input_bounds.height - scroll`. Nothing underlines
and Cmd-click does nothing. A plain click still moves the caret into the link.

## Fix in the app

`EditorAppearance::render` (`apps/gpui/src/editor.rs`) owns Cmd-link handling:

1. `on_mouse_move` resolves the link under the pointer with `link_at` and
   stores it in the `LinkUnderlines` global.
2. `link_contains` hit-tests per row. A soft-wrapped link's bounding box is
   unusable (the first row ends at the pane edge, the last one starts at it), so
   it compares the pointer's row against the first and last character cells and
   treats middle rows as full width.
3. `set_link_underline` writes `TextDecoration::new(range, theme.link + 1px
   underline)` into a per-editor collection, and clears it on Cmd release, on
   leaving the pane and on moving off the link.
4. `capture_any_mouse_down` opens the URI with `cx.open_url` and then
   `window.prevent_default()` + `cx.stop_propagation()`. The engine's
   `on_mouse_down` returns early when the default is prevented, so the URL opens
   once and the caret does not jump.
5. `LinkTargets` stays installed as a fallback for the unscrolled case. The
   engine's `GoToDefinition` action is registered on the editor but the app
   binds no key to it, so in practice it only serves that fallback path.

## Upstream fix

The bounds check should compare against `input_bounds` (the viewport) instead of
the scroll-shifted `last_bounds`. Until `gpui-base` ships that, the app-side
handler stays.

## Tests

- `cmd_click_opens_a_link_below_the_first_viewport` uses a synthetic multi-link
  note, scrolls, checks the underline, opens the URL, and verifies plain clicks
  still place the caret.
- `links_are_colored_and_cmd_click_opens_them_in_the_browser` checks ordinary
  links and Cmd pressed while the mouse is still.
- `document::link_ranges` unit test covers detection rules.
