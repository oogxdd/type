# The desktop skin

The desktop app's look is one deliberately thin presentation layer over an
otherwise unstyled component tree. This document says what the current skin is,
where its pieces live, and which alternatives were considered and rejected — so
a future retheme can start from the reasoning rather than from the CSS.

## What it looks like now

The current skin is modelled on [Write.md](https://github.com/danielbilek/writemd)
(Daniel Bilek, Apache-2.0) — **the visual language only**; none of its code,
features, or assets were copied. The traits taken from it:

| Trait | Value |
|---|---|
| Type | Apple system sans (`-apple-system` / `SF Pro Text`), no negative tracking on body copy |
| Mono | `SF Mono` → `JetBrains Mono` → `Fira Code`, used for labels, badges, code |
| Body size / leading | 16px / 1.75 |
| Measure | one centred 720px column, constant at every window width |
| Background | the native translucent window material — vibrancy on macOS |
| Surfaces | sheer washes (2–6% ink) over that material, never opaque panels |
| Borders | one hairline, 6–12% of the opposite ink |
| Accent | indigo — `#4f46e5` light, `#7c83ff` dark |
| Status | Apple system colours (`#34c759` / `#ff9500` / `#ff3b30` / `#0a84ff` and their dark variants) |
| Headings | h1 2em/700/−0.02em, h2 1.5em/600/−0.01em, h3 1.25em/600 |

Dark is the default, as it is in Write.md.

## Where it lives

Three files, in cascade order:

1. **`apps/desktop/src/app/app.css`, the `:root` DESIGN ATOMS block** — the whole
   palette as `--design-*` custom properties. Retheming the app means editing
   these values and nothing else, in the common case.
2. **`apps/desktop/src/app/app.css`, the skin block at the end of the file** —
   maps the atoms onto `--ui-*` and the shadcn tokens per theme, then restyles
   chrome, lists, the writing column, and the accessories. It is last in the
   file on purpose: it is meant to be deletable in one cut.
3. **`apps/desktop/src/features/notes/navigation/ui/tree.css`** — the navigation
   tree's own rules. It carries no colour literals; everything resolves through
   the tokens above.

Two supporting pieces:

- **`apps/desktop/index.html`** paints the pre-React launch frame, so it repeats
  the base colours as literals. Keep them in step with `--design-*-base`.
- **`apps/desktop/src/app/launch-screen.ts`** exports the same two colours for
  the React side and for the `theme-color` meta tag.

## The window material

Write.md's background is not a colour — it is AppKit vibrancy showing through a
transparent window. This app already ran `transparent: true` with
`macOSPrivateApi`, but painted an opaque floor over it, so the skin needed a real
material to frost against.

`apply_window_material` in `apps/desktop/src-tauri/src/lib.rs` applies one via
the `window-vibrancy` crate: `NSVisualEffectMaterial::UnderWindowBackground` on
macOS (matching Write.md's `vibrancy: 'under-window'`), Mica-then-Acrylic on
Windows, nothing on Linux. The setup hook then writes the result to
`data-window-material` on `<html>`, and the CSS branches on it:

- `blur` — the app paints only a sheer tint; the material *is* the background.
- `none` — the app paints `--design-*-base`, an opaque floor, because a sheer
  tint over a transparent window would show the raw desktop.

`index.html` guesses the value from the user agent before first paint so macOS
never flashes an opaque slab; the Rust side then overwrites the guess with the
truth. `applyThemeToDocument` deliberately leaves `body.style.backgroundColor`
unset under `blur` — an inline background would outrank the stylesheet.

### Why the tint is not sheerer

Write.md sets `--bg: transparent` and lets the vibrancy be the entire
background. That works there because its window has no independent theme — it
follows the system. Here the app's theme is the user's own setting, so a dark
app on a machine in Light Mode gets a *light* frosted backdrop under dark-theme
text and reads washed out. `--design-*-tint` is therefore ~0.6 alpha rather than
0: enough that the palette wins regardless of system appearance and wallpaper,
sheer enough that the blur still moves behind the window.

The alternative — forcing the window's `NSAppearance` to match the app theme so
the vibrancy follows it — would let the tint go to zero, but needs the theme
pushed from the frontend into the shell on every change. Worth doing if the
glass is ever made user-tunable.

## Rejected alternatives

- **Faking glass with `backdrop-filter` alone, no native material.** In a
  `transparent: true` WKWebView the backdrop is the desktop, not a system-tinted
  blur, so the result tracks the wallpaper instead of the system appearance and
  is unreadable over a busy one. The native material is also what makes the
  window match every other macOS app during a Mission Control swipe.
- **Stacking a third skin over the two already in `app.css`.** The file carried
  an aqua-ish light theme and a slate dark theme underneath the previous
  "Network" skin, both at `.app.theme-light` / `.app.theme-dark` specificity —
  so a new layer at `.app x` would silently lose to them. They were deleted
  rather than out-specified; the handful of genuinely structural rules that
  lived inside them (the editor resize handle) moved up into the base layer.
- **Porting Write.md's appearance-profile system** (user-chosen fonts, colours,
  opacity, image/video backgrounds). That is a feature, not a look, and it is
  the thing Write.md is *for*. The skin here is fixed; the only user control
  remains theme and editor font size.
- **A visible 1px window border with 10px radius**, as Write.md draws. Its
  window is frameless; ours keeps native decorations with an overlay title bar,
  so the app would have drawn a second border inside the real one.
- **Bumping the notes list to writemd-ish 16px rows.** The list is a dense
  navigation surface, not prose — it stays at 13px. Only the editor takes the
  16px/1.75 treatment.

## Gotchas

- `DEFAULT_EDITOR_FONT_SIZE` (`apps/desktop/src/shared/constants.ts`) is 16 to
  match the leading and measure. It is the *default* only — anyone who has
  already chosen a size keeps it, since the value is persisted per install.
- The lock screen and the startup splash render *outside* `.app`, so they never
  see the `.app.theme-*` token blocks. They read the `:root` / `:root.dark`
  blocks at the top of the skin instead. Style them there, not with `.app …`.
- `.tiptap-content` is shared by the editor and by the lens's read-only note
  cards. The centred 720px measure is scoped so the lens keeps its own snug
  padding — see `.app .multi-lens-note-readonly .tiptap-content`.
- The yellow sticky notes in the lens (`.multi-lens-text-note`) are intentionally
  outside the palette; they are meant to read as a physical annotation.
