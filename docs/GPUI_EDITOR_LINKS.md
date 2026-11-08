# GPUI editor links: detection, Cmd-click and hover previews

Status: implemented in `apps/gpui`; one engine limitation remains (see
[Remaining limitation](#remaining-limitation)). Kit version: `gpui-kit =0.7.0`
(`gpui-base` 0.7.0, `gpui-component` 0.7.0).

## Pipeline

| Step | Owner |
| --- | --- |
| Find `http(s)` ranges | `type_gpui::document::link_ranges` (`apps/gpui/src/document.rs`) |
| Color them | `editor::color_links`, one `TextDecorationCollection` per editor |
| Cmd-hover underline | `editor::LinkUnderlines` (app-owned decoration collection) |
| Cmd-click opens the browser | `capture_any_mouse_down` on `editor-pane` |
| Unscrolled fallback (engine path) | `editor::LinkTargets` (`DefinitionProvider`) |
| Listing hover preview | `link_hover.rs` + `link_preview.rs`, behind `Preferences::link_previews` (default off) |

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

## Second blocker: the preview popup occludes the text

`link_hover::popup` is a `deferred(anchored())` element with `.occlude()`,
placed at pointer `+(16, 14)`, 360 wide and roughly 330 tall once a listing
preview is ready. It swallows mouse events over whatever it covers, including
the links below the hovered one; near the bottom edge
`snap_to_window_with_margin` can place it over the hovered link itself. With the
engine path, that produced "the second link does not open and the preview stays
on the first".

Mitigations: pressing Cmd dismisses the popup before the pointer is replayed,
and previews default to off.

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

The preview popup is dismissed on Cmd-down so it cannot eat the press.

## Preferences

`Preferences::link_previews` (`apps/gpui/src/preferences.rs`, default `false`)
is passed to `editor::link_support`, which installs the hover provider only when
enabled. `TypeApp::apply_link_previews` rewires every open note editor and every
`FolderWorkspace` buffer when the toggle changes, and dismisses an open popup
when turning previews off. The toggle lives in Settings → Appearance → Editor →
"Link previews". Older `gpui-appearance.json` files have no key, so previews
stay off after upgrade. Cmd-click is unaffected by the flag.

## Remaining limitation

Hover previews still depend on the engine path, so with previews enabled they
appear only for links inside the initial viewport. Fixing that requires the app
to drive `link_hover::pointer_at` itself with its own rest delay; the engine's
150 ms delay currently lives in `handle_hover_popover`.

## Upstream fix

The bounds check should compare against `input_bounds` (the viewport) instead of
the scroll-shifted `last_bounds`. Until `gpui-base` ships that, the app-side
handler stays.

## Tests

`cargo test -p type-gpui -- --test-threads=1` (66 passed):

- `cmd_click_opens_a_link_below_the_first_viewport` — scrolls, asserts the
  underline range and that the URI opens; fails with the engine path alone.
- `cmd_click_opens_the_link_under_an_open_preview` — popup open, Cmd dismisses
  it, all three links open; fails when the popup is left open.
- `link_previews_are_off_by_default_and_cmd_click_still_opens_links`.
- `toggling_link_previews_in_settings_arms_open_editors`.
- `links_are_colored_and_cmd_click_opens_them_in_the_browser` (pre-existing).
- `document::link_ranges` unit test covers detection rules.
