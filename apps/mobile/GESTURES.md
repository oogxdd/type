# Capture-screen gestures

Why the swipe gestures on the capture page are built the way they are, what was
tried, and what was ruled out. Written because the same investigation had been
redone three times: the first two rounds moved thresholds around in
`src/lib/capture-gesture.ts` and did not help, because the thresholds were never
the problem.

Line numbers are from `react-native-screens@4.25.2`,
`react-native-gesture-handler@2.32.0`, `@react-navigation/native-stack@7.17.7`.

## The gestures

Three pans live on the capture page (`src/screens/capture-screen.tsx`),
composed as `Gesture.Simultaneous(keyboardEscape, Gesture.Race(swipeToFile,
swipeToSync))`:

| gesture | direction | what it does |
|---|---|---|
| `swipeToFile` | up | slides the page off the top, files it into Feed, brings a blank page in from below |
| `swipeToSync` | left | pulls in a replica of the Sync header, then pushes the real screen |
| `keyboardEscape` | down at the top of the note | tucks the keyboard away |

Rightward — back to Menu — is **not** one of ours. It belongs to the native
stack (`fullScreenGestureEnabled: true` in `src/App.tsx`'s `screenOptions`).
That single fact is the source of every difficulty below.

## Why the race with the native back gesture cannot be arbitrated

**The native full-screen pop recognizer does not check direction.**

`node_modules/react-native-screens/ios/RNSScreenStack.mm:166-170`:

```objc
@interface RNSPanGestureRecognizer : UIPanGestureRecognizer
@end

@implementation RNSPanGestureRecognizer
@end
```

A bare subclass. No `touchesMoved` override, no direction test, no
`activeOffset`/`failOffset` analog. It is attached to `RNSScreenStackView` — an
ancestor of every screen — in `setupGestureHandlers` (`:888-911`).

`gestureRecognizerShouldBegin:` (`:812-885`) consults exactly one thing, the
**location where the touch started**:

```objc
if ([self isInGestureResponseDistance:gestureRecognizer topScreen:topScreen]) {
  _isFullWidthSwipingWithPanGesture = YES;
  [self cancelTouchesInParent];
  return YES;
}
```

So it recognizes as soon as UIKit's pan slop (~10pt) is exceeded **in any
direction, including straight up**, and `cancelTouchesInParent` (`:788-796`)
then kills the touch stream for everything below it. Direction is only consulted
afterwards, in `handleSwipe:` (`:912-975`), to pick `.x` or `.y` for the
progress calculation — by which point `popViewControllerAnimated:` has already
been called.

**Neither library will defer to the other.** react-native-screens
(`:1170-1189`) only ever agrees to run simultaneously with a `UIScrollView`'s
own pan; everything else falls through to `return NO`. react-native-gesture-handler
(`apple/RNGestureHandler.mm:550-577`) resolves the other recognizer to an RNGH
handler and returns `NO` when there isn't one — which is always, for a foreign
recognizer. `shouldRequireFailureOf` (`:527-534`) and `shouldBeRequiredToFailBy`
(`:504-525`) behave the same.

**And you cannot express a relation even if you wanted to.**
`simultaneousWithExternalGesture` / `requireExternalGestureToFail` /
`blocksExternalGesture` are converted to numeric handler tags before crossing to
native (`src/handlers/gestures/GestureDetector/utils.ts:47-83`):

```ts
function convertToHandlerTag(ref: GestureRef): number {
  if (typeof ref === 'number') return ref;
  else if (ref instanceof BaseGesture) return ref.handlerTag;
  else return ref.current?.handlerTag ?? -1;
}
```

Anything without a `handlerTag` becomes `-1` and is **silently dropped** by the
`tag > 0` filter. There is no error. A native recognizer has no tag.

Conclusion: on the capture page the two recognizer systems are in plain UIKit
mutual exclusion — first to leave `Possible` wins, the loser is cancelled — and
nothing in either library can change that. Every threshold in
`capture-gesture.ts` was a probabilistic hedge against a race that cannot be won
reliably.

## The lever that does work: `gestureResponseDistance`

`isInGestureResponseDistance` (`RNSScreenStack.mm:1042-1063`) compares the
**touch's starting coordinates** against a per-screen rect:

```objc
float x = [gestureRecognizer locationInView:gestureRecognizer.view].x;
float y = [gestureRecognizer locationInView:gestureRecognizer.view].y;
...
return !(
    (start != -1 && x < start) || (end != -1 && x > end) ||
    (top != -1 && y < top) || (bottom != -1 && y > bottom));
```

Values are absolute point coordinates in the stack view's space; `-1` means
unconstrained (the default, i.e. the whole screen).

It gates **both** code paths — the pre-iOS-26 `RNSPanGestureRecognizer`
(`:839`) and iOS 26's `interactiveContentPopGestureRecognizer` (`:872-874`) —
and `@react-navigation/native-stack` forwards it as a screen option
(`src/views/NativeStackView.native.tsx:110`, passed through to `ScreenStackItem`).

So the screen can be partitioned by where the touch starts. It was first split
by *height* (`{ bottom: 0.52 * windowHeight }`); it is now split by *x*
(`{ end: BACK_SWIPE_GUTTER }`), for the reasons in "Round 2" below. Touches
starting in the left gutter keep the untouched native interactive pop; every
other touch on the screen is never offered to the native recognizer at all, so
the app's own gestures own it outright.

Not gated by it: the system's own left-edge pop
(`_UIParallaxTransitionPanGestureRecognizer`), which falls through to an
unconditional `return YES` (`:876-877`). That is why the small negative left
`hitSlop` on our pans stays.

## `manualActivation`, and why `fail()` is expensive

`swipeToFile` and `keyboardEscape` use `.manualActivation(true)`. That installs
a second, invisible recognizer (`RNGestureHandler.mm:445-458`) which blocks the
real one until JS calls `manager.activate()`
(`RNGestureHandlerModule.mm:243-247` → `stopActivationBlocker`). The blocker
itself is maximally permissive — `shouldRecognizeSimultaneously` returns `YES`
unconditionally, `cancelsTouchesInView = NO`
(`RNManualActivationRecognizer.m:16, 91-95`) — which is exactly why the
underlying `ScrollView` keeps scrolling until we claim the touch.

Two consequences that shape the code:

- **Not activating is free.** The gesture just stays in `Possible`; the touch
  stays alive and can still be claimed later in the same drag.
- **`manager.fail()` is terminal for the entire touch.** Once failed, that
  finger is dead until it lifts, no matter what it does afterwards. This is the
  single most damaging thing you can do to a gesture that is trying to feel
  natural, and the old code called it on the first few frames of every drag —
  when `dy` is still ~0 and the drag's intent is genuinely unknowable.

Rule for this screen: **never call `fail()` unless a foreign recognizer is
actually waiting for the touch.** Otherwise decline to activate and keep
watching.

Negative `hitSlop` is also start-of-touch only: `shouldReceiveTouch:`
(`RNGestureHandler.mm:671-689`) tests the touch's location against
`RNGHHitSlopInsetRect` (`:48-69`), so `{left: -24}` means the handler never sees
touches that begin in the leftmost 24pt.

## What the screen does now

- **`gestureResponseDistance: NATIVE_BACK_RESPONSE_DISTANCE`** — that is
  `{ end: BACK_SWIPE_GUTTER }` — on the Capture screen (`src/App.tsx`). Inside
  the left gutter the native interactive pop is exactly what it always was.
  Everywhere else the native recognizer is never offered the touch.
- **The pan's `hitSlop({ left: -BACK_SWIPE_GUTTER })`** lines our side up with
  it from the other direction, so the two never overlap. `x <= 24` is
  navigation's, everything else is ours, and no zone is contested. There is no
  longer any place where `manager.fail()` hands a touch to a foreign
  recognizer, because there is no longer a foreign recognizer to hand it to.
- **A rightward drag outside the gutter** calls `navigation.popTo("Menu")` from
  the gesture. Same native pop animation, just not driven under the finger.
  This now applies to the whole screen rather than half of it.
- **A commit no longer blocks the next touch.** Filing hands the fresh page over
  immediately instead of waiting up to 1200ms for storage, and a touch that
  arrives while the commit spring is still running is *declined* (the gesture
  stays in `Possible` and can still claim the touch when the spring ends) rather
  than failed.
- **The Gesture trace** (Settings → Diagnostics → Record swipes) writes one line
  per touch, so the band line and the thresholds can be moved from evidence.

## Rejected alternatives

Kept here so the decision can be revisited without redoing the research.

### A. Own the back swipe with a Menu replica

Turn the native gesture off on Capture entirely (`fullScreenGestureEnabled:
false`, `gestureEnabled: false`) and drive Capture → Menu ourselves, with the
idiom the app already uses twice.

How that idiom works, for whoever picks this up:

- A shared value `0..1` (`syncProgress` in `capture-screen.tsx`,
  `captureProgress` in `menu-screen.tsx`) is driven by the pan's `onUpdate` from
  `-translationX / windowWidth`.
- Three animated styles: a parallax `translateX` on the current screen's
  wrapper, a dim layer at `0.08 * progress`, and the incoming replica at
  `translateX: width * (1 - progress)` with `opacity: progress > 0 ? 1 : 0`.
- The replica is a **hand-drawn static approximation** of the destination —
  see `menu-screen.tsx`'s capture replica and its geometry comment, and
  `capture-screen.tsx`'s Sync header replica.
- On release past `0.3` (or a flick past `-500`), animate progress to 1 over
  160ms, then `navigation.navigate(target, { instant: true })`. The screen's
  `animation` option resolves to `"none"` when `route.params?.instant`, so the
  real screen attaches with no second transition underneath the opaque replica.
- A `setTimeout(..., 400)` parks progress back at 0 once the mount is covered,
  and `useClearInstantParam` (`src/navigation.ts:54-76`) removes the one-shot
  flag on `transitionEnd`.

Upside: the rightward swipe works across the entire screen with no dead band,
and the whole page is one arbitration domain. Downside, and why it was not
chosen: Menu is a `SectionList` of real notes with tabs and a folder tree, so a
static replica visibly differs from the destination, and mounting a second real
`MenuScreen` is not viable — it carries live store subscriptions, its own
`tab`/`filter`/`expanded` state, a `useNoteOrganizer` overlay, an
`InteractionManager` first-paint deferral, and its own `GestureDetector`.

**Re-opened by `experiments/gesture_lab`.** Both objections above are objections
to *replica-then-push*. The Flutter prototype does neither: Menu is mounted
once, permanently, behind Capture, and the whole interaction is a `translateX`
on a single progress value. There is no replica to diverge from the destination,
the mount cost is paid at startup instead of under the finger, and Menu's
`tab`/`filter`/`expanded`/scroll state persists across trips — which is a
feature rather than a cost. Capture stops being a pushed screen, so the native
pop recognizer is not in the picture at all and the gutter carve-out above can
go too.

What that route still owes: an explicit `BackHandler` for Android hardware back
(currently free from the stack), Menu staying subscribed for the life of the
app, and hand-matching the push spring since UIKit's is no longer doing it.

One more wrinkle for this route: the pop must not animate, so Capture's
`animation` option needs to be `"none"` at pop time. Setting a route param and
popping in the same tick races the transition; the clean version is to make
Capture's animation `"none"` unconditionally and drive all three of its
transitions from the app's own progress values.

### B. `goBackGesture` from react-native-screens

The declarative API (`src/gesture-handler/ScreenGestureDetector.tsx`) disables
the native gesture (`:65-75` → `ios/RNSModule.mm:92-100`) and drives the **real**
screens with reanimated's `startScreenTransition`. Attractive on paper. Ruled
out:

- **`@react-navigation/native-stack@7.17.7` never forwards it.** grep for
  `goBackGesture|screensRefs|currentScreenId|gestureDetectorBridge` across the
  package's `src/` and `lib/` returns zero hits; `NativeStackView.native.tsx:530`
  renders a bare `<ScreenStack>`. Using it means forking `NativeStackView`.
- Its `Pan` is constructed inline in the render body (`:221`), unmemoized, never
  exposed by ref — so its tag is unstable and no other gesture can reference it.
  The same unarbitrable race returns, in JS.
- With `screenEdgeGesture: false` it has no `activeOffsetX`, no `failOffset`, no
  `hitSlop` — a bare pan over the whole stack.
- `disableSwipeBack` is **stack-wide**, not per-screen, and is only re-enabled
  on a non-cancelled finish (`RNSModule.mm:85-87`).
- The release animation is a hand-rolled `requestAnimationFrame` loop with
  `easeOutQuart` and fixed velocities (`reanimated/src/screenTransition/swipeSimulator.ts:10-35`),
  not the system spring, and the native animator contributes nothing — it
  branches to `animateWithNoAnimation` whose animation block is empty
  (`RNSScreenStackAnimator.mm:87-89, 461-481`), so there is no shadow either.
- `throw new Error('[RNScreens] Failed to measure screen.')` inside a worklet
  (`ScreenGestureDetector.tsx:154-157`), with the graceful branch below it
  unreachable. On the new architecture the UI runtime is the iOS main thread, so
  that is an uncatchable abort. The `measure` it guards returns `null` in
  several ordinary cases.
- Android has no `disableSwipeBackForTopScreen` at all
  (`android/src/main/cpp/jni-adapter.cpp:80-82`).

### C. Keep tuning thresholds

What the first two rounds did. It cannot work: the competing recognizer fires on
~10pt in any direction and cancels the touch, so no threshold on our side
changes who wins. See the top of this file.

## Findings from the on-device trace

Filled in from the Gesture trace readout in Settings → Diagnostics.

### Round 2 — from reading the code, not the trace

Two defects found by re-deriving the arbitration by hand after a Flutter
prototype of the same three interactions (`experiments/gesture_lab`) turned out
to be reliable where this is not. Both produce the same symptom — "the swipe
works every other time" — and neither is a threshold that can be tuned.

**The vertical latch was narrower than the fail that follows it.**
`isVerticalCommitted` required `|dx| < |dy|`, i.e. within 45° of vertical. A
thumb pivots at its base, so a swipe up from the lower right *arcs left* as it
extends, and breaks 45° constantly in its first frames. A drag that missed the
latch fell through to `horizontalVerdict`, whose leftward branch has no
dominance test at all — so an ordinary `dx = -26, dy = -14` read as `"sync"` and
called the **terminal** `manager.fail()`.

The touch was then handed to nobody: `swipeToSync` could not have taken it
either, because its own `failOffsetY([-24, 24])` kills it the moment the drag
goes vertical. Fixed by widening the latch with `VERTICAL_LATCH_RATIO = 2`
(~63° of vertical). The verdict itself is unchanged — the latch is the right
place, because it is *permanent* for the touch, so no later wobble can undo it.

A residual window remains by construction: between `dy = 0` and
`dy = -VERTICAL_LATCH` the latch cannot engage yet, so >24pt of lateral drift in
the first ~12pt of travel still resolves by verdict. That is genuinely ambiguous
input. `verdictDx`/`verdictDy` in the trace now record the exact frame each
verdict fired at, so this can be measured rather than argued about.

**The back swipe was two different gestures wearing one name.** Split by height
at 52%, a touch above the line got the native recognizer (activating on ~10pt in
*any* direction, driven interactively under the finger) and a touch below it got
ours (`dx > 24 && dx > |dy|`, then a non-interactive `popTo`). Thresholds 2.5x
apart and a different feel, selected by where the thumb happened to land — a
line a thumb crosses constantly. Inconsistency was the design, not a bug in it.

It also cost the swipe *up*: above the line the native recognizer fires on
upward movement too, so any swipe up starting in the top half was cancelled
before it began. Round 1 read as though swipes up simply start low (y>=499);
they start low because the ones that started higher never registered.

Fixed by moving the partition from height to x — `{ end: BACK_SWIPE_GUTTER }`,
flush against the pan's existing `hitSlop({ left: -24 })`. The native pop keeps
the gutter, where UIKit's own uncancellable edge pop lives anyway and where a
back swipe actually starts; everything else is one uncontested domain.

The cost, stated plainly: the interactive finger-driven pop is now only
available from the gutter. A rightward drag anywhere else is a triggered
animation. That is the same trade already accepted for the lower half of the
screen — it now applies uniformly. Making it finger-driven everywhere is
alternative A below, which the Flutter prototype re-opens: see the note there.

### Round 1 — build 0.2.10, iPhone 430×932pt, 27 rows

Two mechanical bugs in the trace itself showed up first and are fixed:

- **Every handed-over touch was recorded twice.** `onFinalize` fires once when
  `manager.fail()` resolves the handler and again when the finger lifts, so each
  `→ back` row appeared as a long/short pair with identical coordinates. Guarded
  with `traceEmitted`.
- **A row could not be read without knowing the window height**, since whether
  the band applied is the difference between "the native pop took it" and
  "nothing was competing and it still failed". Rows now print `band` / `free`.

Discounting the duplicates, the sample is 14 back swipes and 5 swipes up:

| gesture | startY | startX | travel |
|---|---|---|---|
| back (`→ back`) | 229 … 474, one at 564 | 29 … 195 | dx 26–59, \|dy\| ≤ 11 |
| up (`→ released`) | 499 … 529, one at 869 | 204 … 301 | dy −11 … −33 |

Three things follow.

1. **The 0.7 line was in the wrong place.** Its bottom on this device is 652pt,
   so *every* swipe up in the sample started inside the band and was contested
   by the native pop — the split never protected the gesture it exists for.
2. **The two gestures do separate by height, just not there.** Back swipes stop
   at y≈474 and swipes up start at y≈499. `NATIVE_BACK_BAND_FRACTION` moved to
   **0.52** (≈485pt here), which leaves 13 of the 14 back swipes on the native
   interactive pop and puts all the swipes up in the free zone. They separate by
   *x* too — back on the left half, up in the centre — which is a second lever
   (`gestureResponseDistance.end`) if height alone turns out not to be enough.
3. **`maxDy` on an activated touch was measuring the wrong thing.** It looked
   as though no swipe up ever travelled past 33pt, which would have meant a
   second unexplained cause. It does not: RNGH stops delivering `onTouchesMove`
   once the handler activates, so on any `released` row `dy` is the travel *up
   to the claim* and nothing after it. The rest of the swipe was never recorded.
   `maxPull`, taken from `onUpdate`, now records it.

Note also that no row in this sample reached `stolen` — every failed swipe up
was `released`, i.e. we *did* claim the touch and it ended without committing.
`released` was lumping together two different things, so it is now split:
`cancelled` (we owned it and `onEnd` arrived with `success = false`, meaning
something took it back mid-drag) versus `released` (a pull the user genuinely
did not finish). Round 2 needs `pull=` and `cancelled` to say which of the two
"the swipe up did not register" actually is.
