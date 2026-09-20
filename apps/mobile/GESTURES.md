# Home gestures

`HomeScreen` is one native-stack root containing persistent Menu and Capture
layers. Native stack gestures are disabled on Home. Detail routes still use
normal native navigation. Opening/closing the menu preserves the draft, cursor,
scroll, menu filter and expanded folders. No replica page is used for the menu.

## One direction owner

`home-screen.tsx` owns one memoized `Gesture.Pan` with manual activation. All
four directions use `resolveSwipeDirection` in `lib/capture-gesture.ts`:

- Ignore movement under 12pt.
- Choose an axis only when it dominates the other by 1.6×.
- At 24pt radial travel, unresolved diagonal movement declines navigation.
- Once chosen, direction stays fixed until release; later thumb curvature does
  not turn an upward pull into a menu swipe.
- Held touches (>350ms before a direction is chosen) stay with text selection
  or a list row's long-press action. Multiple fingers cancel the gesture.

The native text/list scroll recognizers are connected through `Gesture.Native`
and simultaneous relationships. Vertical movement keeps native scrolling.
Horizontal movement disables scrolling through animated props and tracks the
menu under the finger. The common release handler finishes or cancels the menu
transition. A cancelled touch always returns to its starting surface.

This is one coordinator for app commands, not a replacement for native text
selection, keyboard interaction or scrolling. A diagonal can still scroll text;
it must never navigate or file a page.

## Pull to start a new note

The native ScrollView's bottom overscroll supplies the pull distance. Scrolling
through a long note contributes zero to the threshold. The same continuous
finger movement can scroll to the end and continue into a pull.

- At 12pt overscroll the label starts appearing: **Pull up for a new note**.
- At 80pt overscroll it changes to **Release to start a new note**, with a light
  selection haptic. These are rubber-banded content points, not finger travel.
- Readiness remains until the pull retreats below 64pt, avoiding label/haptic
  flicker at the boundary. Retreat farther and release to cancel.
- Only a successful upward pan release while ready starts the new-page
  transition. Speed is deliberately absent from this decision.
- Momentum, cancelled touches and layout-only scroll events cannot commit.
  Overscroll updates readiness only while the shared pan is actively vertical.
- The label stays above the keyboard. The fresh page receives typing focus.

Capture retains the old draft until its save succeeds. If storage fails, the
old page returns with its text. Opening the menu flushes without clearing it.
A registered flush runs before switching working folders; Home's state is
scoped to the profile/root. Returning from the menu reloads a saved draft to
respect edits, moves or deletion performed there.

## Diagnostics and verification

Settings → Diagnostics → Record swipes records direction, largest displacement,
pull distance and outcome for the shared gesture, without note text. `filed`
means a release requested a new page, not confirmation that storage succeeded.

Automated cases cover direction locking, rejected diagonals, long/short notes,
readiness/retraction, cancelled releases and horizontal settling. The owner
checks physical gesture feel on iOS; no computer-use gesture testing is required.

Try both with and without the keyboard: menu open/close, long-note scrolling,
a slow pull/release, a short fast flick, retracting from ready, diagonal starts,
text selection and successive new notes. Also try editing/moving/deleting the
saved draft from the menu and switching working folders.

## Earlier experiments

`experiment/capture-gestures` explored persistent layers and a bottom-overscroll
label. `archive/native-edge-menu-ios` contains a UIKit edge-menu experiment;
`archive/mobile-drawer-nav` contains the drawer version. Their implementation
and historical investigations remain in those refs and this file's Git history.

The previous main version mixed a native-stack full-screen pop with several
RNGH pans and split the screen by height. That ownership conflict is why Home
now has no native pop recognizer. Do not restore the split as a threshold fix.

Folder note paging is a subsequent feature: reuse the direction/release model,
but give top/bottom edges previous/next actions in the browsing context.
