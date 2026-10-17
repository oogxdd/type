# Home gestures

`HomeScreen` is one native-stack root containing persistent Menu and Capture
layers. Saved notes use the same Capture surface; there is no separate editor
route. Native stack gestures are disabled on Home. Settings and folder routes
still use normal native navigation. Opening/closing the menu preserves the draft, cursor,
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

- Capture counter-translates only native bottom rubber-banding inside the
  content, keeping the old text stationary. Ordinary scrolling is unchanged.
- Settings → Appearance → New note transition selects **New layer** (study A,
  with a settling shadow) or **Pause** (fade on the same surface). Preferences
  live in device-local `appearance.json`, outside the notes root.
- New layer's **Gradient** hint stays above a background-colored fade. **On
  sheet** reveals up to 92pt of the incoming sheet while pulling, with the hint
  on its leading edge. Release continues from the actual released pose, including
  a retracted-but-still-ready pull; it never resets the sheet first.
- At 52pt the arrow and label fade in, reaching full opacity at 72pt. Pause
  always uses the gradient hint and fades it in place after release; its height
  never collapses down. Neither capture hint has a gray strip.
- At 100pt it changes to **Release to start a new note** and its color goes from
  secondary to primary, with a light selection haptic. These are rubber-banded
  content points, not finger travel.
- Readiness remains until the pull retreats below 83pt, avoiding label/haptic
  flicker at the boundary. Retreat farther and release to cancel.
- Only a successful upward pan release while ready starts the new-page
  transition. Speed is deliberately absent from this decision.
- Momentum, cancelled touches and layout-only scroll events cannot commit.
  Overscroll updates readiness only while the shared pan is actively vertical.
- The hint and incoming sheet sit above the keyboard. The fresh page receives typing focus after
  React has applied `editable=true` to the replacement native input; requesting
  focus in the same callback that ends the transition can leave UIKit read-only
  and dismiss the keyboard.

The saved-note browsing strip uses one numeric `top` coordinate computed from the measured capture
surface height, keyboard height and strip height. Switching animated `top` and
`bottom` values to `undefined` can retain an old edge after a downward gesture,
causing the next upward pull's label to appear at the top. Upward pulls always
align the strip with the visible bottom; browsing backward retains the top edge.

Capture retains the old draft until its save succeeds. If storage fails, the
old page returns with its text. The replacement editor is installed only behind
the fully covering sheet/fade; focus waits for the editable native input. Opening the menu flushes without clearing it.
A registered flush runs before switching working folders; Home's state is
scoped to the profile/root. Returning from the menu reloads a saved draft to
respect edits, moves or deletion performed there.

## Browsing saved notes

Selecting a note loads it into the same paper surface. The microphone is hidden
(an already active recording keeps its Stop control available);
recording notes retain their audio player. Edits use the serialized, retryable
capture save queue. A failed write/read retains the current page.

Pull up past the bottom to open the next note; pull down past the top to open
the previous note. Both use the same distance/readiness/retraction rules as
capture. The list order and filter are captured when selecting a note. At either
end, an unavailable neighbor disables the corresponding action. Downward pulls
on capture do nothing. Browsing never files or deletes an emptied saved note.

Opening the menu returns the hidden paper to capture mode; closing the menu
reveals the retained draft, or a blank page if there was none. Selecting another
note in the menu opens that note instead. Lists and their native recognizers
mount together at startup; only row construction is deferred, so loading cannot
replace the recognizer tree during a swipe. After unlock, the profile is loaded
before mounting Home to avoid resetting the workspace during initial load.

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

Functional checks cover ordered browsing in both directions, list boundaries,
failed saves/reads, retaining drafts and editing the draft through the list.
Physical startup timing and gesture feel on iOS/Android remain device checks.

## Keeping the caret visible while typing

On iOS the `EditorScroll` local Expo module reads UIKit's actual collapsed
selection after text, selection, input layout or keyboard viewport changes.
It also measures the native text with `sizeThatFits` and returns only its height
to the shell. The uncontrolled, non-scrolling Fabric input can otherwise stay
at its initial viewport height after typing: neither the enclosing paper nor
the caret geometry then reflects the text below the keyboard. The measured
minimum height lets Yoga grow (and shrink) the paper; the resulting layout runs
the caret reveal again. It resets when replacing the native input for a page.
It scrolls the enclosing paper only far enough to reveal the caret with a
16pt margin, rather than pinning every edit to the bottom of the note. This
also follows soft wraps and edits in the middle of long notes without
estimating line positions from Markdown or measuring a second copy of the text.
Native drag/deceleration and nonempty selections retain control; an unfocused
or disabled editor cannot move the paper. Calls are coalesced to one per frame.
Android and clients without the module retain the existing bottom anchoring.

This requires `pod install` and a native rebuild. Geometry checks:
`sh apps/mobile/modules/editor-scroll/tests/test-scroll.sh`.
Expo module registration:
`node apps/mobile/modules/editor-scroll/tests/test-autolinking.cjs`.
The `TypeResponsiveness` iOS XCTest harness also covers typing 32 lines, native
scrolling back to the beginning, pulling a fresh draft, and soft wraps with
Unicode input. Its simulator-only, opted-in Dev accessibility probe reports
UIKit caret/scroll geometry without note content. Run the
`testTypingPastKeyboard` and `testSoftWrappedTypingPastKeyboard` cases using
the isolated simulator instructions in `docs/MOBILE_RUNTIME.md`.
On the device, check typing past the keyboard, soft wraps, inserting/deleting
in the middle of a long note, moving the caret, selection, keyboard reopening,
manual scrolling and pull-to-new-note.

## Taps during background work

Button handlers use the coordinator's per-touch JS press gate. Direction
selection cancels that touch only; the next touch begins a new gate immediately.
There is no post-swipe time window and handlers do not synchronously read UI
shared values. A pending manual pan fails on touch release so native buttons
can finish their tap. Opening the menu or Settings does not await storage or
preview processing. See [runtime ownership](../../docs/MOBILE_RUNTIME.md).
