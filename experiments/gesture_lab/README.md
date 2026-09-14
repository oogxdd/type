# gesture_lab

A throwaway Flutter app for feeling out three interactions before committing to
them in the real app. Not wired to `type-core`, no persistence, no navigation
framework — three screens' worth of widgets and one custom gesture recognizer.

```
cd experiments/gesture_lab
flutter run            # pick a phone or simulator; desktop has no touch
flutter test           # the four interaction regressions
```

A small HUD in the top-right shows live gesture numbers (`menu` progress, `pull`
px vs threshold, accumulated drag delta). Tap it to hide; "show hud" in the menu
brings it back.

## The three interactions

**Type immediately.** The app opens on a focused blank note. `note N` in the
corner is just so you can see which one you are on.

**Swipe right anywhere → menu.** Not an edge gesture — anywhere on the screen,
including on top of the text. The menu is not pushed on top of anything: it sits
*behind* the capture page, which slides right to reveal it (with parallax and a
shadow, iOS-push style). Swipe left, or tap the capture page, to come back.

The capture page is never unmounted, so you land back on the same note, the same
scroll offset, and the same caret position. Swiping is finger-driven the whole
way — let go under 40% and it snaps back, flick it and velocity decides.

**Pull up past the end → new note.** Scroll to the bottom of the note, keep
dragging, and a tab comes up out of the bottom edge on a stem, stretching as you
pull. Past the threshold it turns blue, says *Release for new note*, and ticks
haptically. Release and the note slides off the top while a blank one rides in
from below. Release early and it springs back.

## What was actually hard

### The pull is overscroll, not a gesture

The requirement "you have to reach the end of the note first, *then* it becomes a
pull" is a scroll-position condition, not a gesture condition. So the pull is not
a recognizer at all — it reads `pixels - maxScrollExtent` off the scroll view's
own `BouncingScrollPhysics` overscroll. Reaching the end first is then not a rule
anyone has to enforce; there is simply no overscroll until you get there, and the
rubber-band resistance gives the pull its weight for free.

`BouncingScrollPhysics` is set explicitly rather than left to the platform —
Android's default clamping physics has no overscroll to read.

The commit fires on **pointer-up** (a raw `Listener`), not on
`ScrollEndNotification`, which arrives after the bounce-back settles — far too
late to feel like a release.

### A TextField silently eats horizontal swipes

This is the one that would have been very hard to find by poking at it, and it is
probably the same class of bug as the React Native version.

`TextField` installs a `TapAndHorizontalDragGestureRecognizer` for caret
dragging. Two properties of it matter:

- It is **deeper in the hit-test path** than any shell-level gesture detector
  that *wraps* the page, so it is dispatched first.
- On Android it is constructed with `eagerVictoryOnDrag: true` (see
  `widgets/text_selection.dart` — the flag is literally
  `defaultTargetPlatform != TargetPlatform.iOS`), so it claims the gesture arena
  the instant it clears the touch slop rather than waiting to see what the
  gesture becomes.

Both recognizers use ~18px of slop. During a fast flick a single pointer move can
be 20-30px, clearing both thresholds in the same event — and the one dispatched
first wins. So the swipe worked when you moved slowly and failed when you flicked,
which reads exactly like "it doesn't capture my gestures well". On iOS it mostly
worked, because `eagerVictoryOnDrag` is false there.

**Fix: put the swipe layer on top of the page, not around it.** A `Stack`
hit-tests topmost-first, and `HitTestBehavior.translucent` puts a layer into the
hit path *without* consuming the touch. So the swipe recognizer is now a
`Positioned.fill` sibling painted above the pages: it is dispatched before the
text field's recognizer, while taps, scrolls and text selection still fall
through to the page underneath. The outcome no longer depends on how fast the
finger happens to be moving.

Rejected along the way:

- **Raising the field's touch slop via `MediaQuery.gestureSettings`.** Looks like
  the designed lever, and is inert: `TextSelectionGestureDetector` never assigns
  `gestureSettings` to its recognizers, so they always fall back to `kTouchSlop`.
- **`enableInteractiveSelection: false`.** The recognizer is installed
  regardless of that flag, so it does not even fix the problem — and it would
  cost long-press selection and the drag handles.
- **Driving the swipe from a raw `Listener`, outside the arena.** Works, but the
  text field still receives the drag and moves the caret underneath you on
  Android. Sidestepping arbitration instead of winning it.

### Direction is decided, not raced

`DirectionalHorizontalDragRecognizer` (`lib/gestures.dart`) replaces
first-past-the-post with an explicit verdict on the accumulated delta:

- vertical-dominant (`|dy| > 8` and `> 1.2 * |dx|`) → **self-reject**, handing the
  scrollable a clean win;
- horizontal-dominant (`|dx| > 12` and `> 1.2 * |dy|`) → **self-accept**.

`acceptGesture` replays the pending offset through `onStart`/`onUpdate`, so
deciding before the usual slop costs nothing. Both decisions need real
directional evidence, so taps and long-presses are untouched. The recognizer is
only ever *less* greedy than the stock one on vertical drags, so it cannot steal
a scroll.

### Test harness gotcha

`TestGesture.moveBy` stamps every event at `t = 0` unless you pass `timeStamp`.
`VelocityTracker` then reports zero, and every velocity/fling branch in the app
is silently skipped — tests pass or fail for reasons unrelated to what they claim
to check. `dragInSteps` in `test/widget_test.dart` threads a real clock through.

## Tunables

| Where | What |
|---|---|
| `capture_page.dart` | `kPullThreshold` (80px of overscroll), `kTabHeight` |
| `gestures.dart` | `verticalBailout` (8), `horizontalCommit` (12), `dominanceRatio` (1.2) |
| `main.dart` | menu open threshold (40% of width), velocity cutoff (420 px/s), animation durations |

Note that 80px of *overscroll* is more finger travel than it sounds — bouncing
physics applies roughly 50% friction at the start and increases from there.

## Known limits

Deliberate, given this is only meant to test the three interactions:

- Notes live in memory. Nothing is written anywhere.
- Only the capture↔menu trip preserves scroll offset. Jumping to a note from the
  menu list rebuilds that page, so text survives but scroll offset does not.
- Empty notes are filed like any other, and show as *Empty note* in the menu.
- The keyboard is dismissed on menu open and restored on close. Worth feeling on
  a device — the viewport resize can shift the scroll offset slightly.
