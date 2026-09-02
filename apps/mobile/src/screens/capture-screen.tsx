// The home screen and the app's signature interaction: a blank page you can
// type on immediately. Swiping up slides the page off the top while a fresh
// blank page rides in from the bottom under the same finger — release past
// the threshold (or flick) commits it; the keyboard stays up so you can keep
// typing. Notes land in Feed via the desktop-compatible core.
//
// This is the middle screen in the pre-pager native-stack model: Menu sits
// behind it to the left, while Sync is pushed to the right. Native back
// reveals Menu; a leftward drag drives a live Sync preview before the real
// screen is attached underneath it.
//
//   swipe UP   → file the page. The pan uses manual activation gated on the
//                scroll geometry (shared values), so on a long note one
//                continuous drag scrolls to the bottom and rolls straight
//                into pulling the next page in; on a short note it claims
//                immediately. Works with the keyboard up — the fresh page
//                then enters from the keyboard's top edge.
//   swipe DOWN → the ScrollView's native interactive keyboardDismissMode
//                (drag toward/past the keyboard, Apple-Notes style), plus a
//                quick pull-down at the very top of the note. Both leave the
//                scroll untouched — the dismiss observer never activates.
//
// The TextInput no longer scrolls itself: an outer ScrollView owns scrolling
// (the input auto-grows), which is what makes interactive keyboard dismissal,
// UI-thread edge gating, and the custom barely-there scroll indicator
// possible. The page's bottom padding tracks the keyboard height so the text
// always sits above it, and content growth keeps the bottom pinned while
// you're typing at the end (scroll anchoring), like Apple Notes.

import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  type LayoutChangeEvent,
  type ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as core from "@typenotes/mobile-core/core-api";

import { CaptureSession } from "../lib/capture";
import {
  ACTIVATE_PULL,
  BACK_SWIPE_GUTTER,
  ESCAPE_DRAG,
  horizontalVerdict,
  isInNativeBackBand,
  isVerticalCommitted,
  isAtScrollBottom,
  shouldCommitFiling,
  SYNC_RIGHTWARD_FAIL,
  TOP_SLACK,
  visiblePageHeight,
} from "../lib/capture-gesture";
import {
  type GestureAttempt,
  recordGestureAttempt,
} from "../lib/gesture-trace";
import { autoSyncLabel } from "../lib/sync-experience";
import { useClearInstantParam, type RootStackParamList } from "../navigation";
import { useDiagnosticsStore } from "../state/diagnostics-store";
import { useNotesStore } from "../state/notes-store";
import { useSyncStore } from "../state/sync-store";
import { useTheme } from "../theme";
import { DictationButton } from "../ui/dictation-button";
import { ToolbarButton } from "../ui/toolbar-button";

// The swipe's thresholds and decision arithmetic live in ../lib/capture-gesture
// so they can be tested without a device; the comments there explain why each
// one is the value it is.

// Horizontal Capture -> Sync preview mechanics, matching Menu -> Capture.
const SYNC_OPEN_PROGRESS = 0.3;
const SYNC_OPEN_VELOCITY = -500;
const SYNC_PARALLAX = 0.3;

const PLACEHOLDER = "Start typing…";

const COMMIT_SPRING = {
  damping: 34,
  stiffness: 320,
  overshootClamping: true,
} as const;
const CANCEL_SPRING = {
  damping: 26,
  stiffness: 280,
  overshootClamping: true,
} as const;

/**
 * The auto-sync status line, with its own store subscription.
 *
 * Deliberately not a `useSyncStore` call inside CaptureScreen: every state
 * change there re-renders the screen, and a re-render rebuilds the whole
 * gesture graph (see the useMemo comment on captureGestures). Sync flips to
 * "syncing" a second after every filing, i.e. right in the middle of the
 * commit spring.
 */
const SyncStatusLabel = ({ top }: { top: number }) => {
  const theme = useTheme();
  const autoSyncState = useSyncStore((state) => state.autoSyncState);
  // Off unless Settings -> Diagnostics turns it on: the capture page is meant
  // to be a blank sheet, and the same state is on the Menu and Sync screens.
  const enabled = useDiagnosticsStore(
    (state) => state.diagnostics.showCaptureSyncStatus
  );
  const label = autoSyncLabel(autoSyncState);
  if (!enabled || !label) {
    return null;
  }
  return (
    <View pointerEvents="none" style={[styles.syncStatus, { top }]}>
      <Text
        style={{
          color:
            autoSyncState === "synced"
              ? theme.colors.success
              : theme.colors.secondaryText,
        }}
      >
        {label}
      </Text>
    </View>
  );
};

export const CaptureScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { height, width } = useWindowDimensions();

  const [text, setText] = useState("");
  const [iconsVisible, setIconsVisible] = useState(true);
  const [recordingActive, setRecordingActive] = useState(false);
  const iconsOpacity = useSharedValue(1);
  // The mic fades rather than unmounting: DictationButton allocates a native
  // recorder, and remounting it at the exact moment the fresh page arrives put
  // that allocation inside the commit window.
  const micOpacity = useSharedValue(1);
  const inputRef = useRef<TextInput>(null);
  // A plain ref, not useAnimatedRef: nothing reads the scroll view from a
  // worklet any more, and an animated ref only exists to be handed to the UI
  // runtime. See scrollToY below.
  const scrollRef = useRef<ScrollView>(null);

  // The keyboard height (0 when hidden) as a UI-thread shared value; the page
  // padding and the floating controls ride it so nothing hides under the
  // keyboard, and it also defines the visible page height for the swipe.
  const keyboard = useAnimatedKeyboard();

  // Live scroll geometry as shared values — the gestures and the custom
  // scroll indicator read these on the UI thread, so edge gating never waits
  // on the JS thread.
  const offsetY = useSharedValue(0);
  const viewportH = useSharedValue(0);
  const contentH = useSharedValue(0);
  // JS-side mirrors for the scroll-anchoring math in the content-size and
  // layout handlers (previous values, which the shared values no longer hold).
  const viewportHRef = useRef(0);
  const prevContentHRef = useRef(0);

  // The window as shared values. The gesture worklets need these, and a
  // memoized gesture cannot close over a prop that changes on rotation.
  const windowH = useSharedValue(height);
  const windowW = useSharedValue(width);
  useEffect(() => {
    windowH.value = height;
    windowW.value = width;
  }, [height, width, windowH, windowW]);

  // 0..-V — how far the current page has slid up (V = visible page height).
  const pageY = useSharedValue(0);
  // True from commit-release until the fresh page has swapped in.
  const transitioning = useSharedValue(false);

  const indicatorOpacity = useSharedValue(0);

  // One session per page, not one per screen: filing hands the finished page's
  // session off to storage and the fresh page starts on its own, so a keystroke
  // that lands while the previous write is still in flight can never be folded
  // into the note being filed.
  const newSession = useCallback(
    () =>
      new CaptureSession({
        createNote: async (content) => {
          const path = (await core.createNote({ content })).path;
          useSyncStore.getState().scheduleAutoSync("capture saved");
          return path;
        },
        writeNote: async (path, content) => {
          await core.writeNote(path, content);
          useSyncStore.getState().scheduleAutoSync("capture saved");
        },
        deleteNote: async (path) => {
          await core.deleteItems([path]);
          useSyncStore.getState().scheduleAutoSync("capture deleted");
        },
      }),
    []
  );
  const sessionRef = useRef<CaptureSession | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = newSession();
  }

  // Stack navigation emits blur for Menu, Sync, and all pushed destinations.
  // Flush before this capture screen becomes hidden or is popped.
  useEffect(
    () =>
      navigation.addListener("blur", () => {
        // Navigation should never turn a storage rejection into a fatal,
        // unhandled JS error. CaptureSession keeps the draft dirty for retry.
        void sessionRef.current?.flush().catch(() => {});
      }),
    [navigation]
  );

  // Menu's finger-driven preview can attach Capture with animation disabled;
  // clear that one-shot flag once mounted so later native back gestures work.
  useClearInstantParam();

  // Wrap Keyboard.dismiss so the worklet captures this plain closure rather
  // than the bare method — passing Keyboard.dismiss straight to runOnJS makes
  // worklets try to copy its owner (KeyboardImpl), which it can't serialize.
  const dismissKeyboard = useCallback(() => Keyboard.dismiss(), []);

  const showIcons = useCallback(() => {
    setIconsVisible(true);
    iconsOpacity.value = withTiming(1, { duration: 180 });
  }, [iconsOpacity]);

  const hideIcons = useCallback(() => {
    setIconsVisible(false);
    iconsOpacity.value = withTiming(0, { duration: 180 });
  }, [iconsOpacity]);

  // Reveal the fresh blank page. The filed page is off-screen at this point
  // (the ghost covers the viewport), so clearing the input is invisible.
  const openBlankPage = useCallback(() => {
    setText("");
    prevContentHRef.current = 0;
    offsetY.value = 0;
    // No scrollTo here. The fresh page's content is empty, so the reused
    // ScrollView is already at the top.
    showIcons();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        pageY.value = 0;
        transitioning.value = false;
      })
    );
  }, [offsetY, pageY, showIcons, transitioning]);

  // The committed page is off-screen; bring the fresh one in at once and let
  // the write finish behind it.
  //
  // This used to wait for storage (bounded at 1200ms) so that a failed write
  // could spring the original page back. The wait cost far more than it bought:
  // `transitioning` stays true for its whole length, and every touch that
  // landed in that window was killed outright — so the natural reaction to a
  // swipe that "didn't work", swiping again immediately, was guaranteed to fail
  // too. The window is now just the commit spring, and a touch inside it is
  // merely declined rather than failed (see swipeToFile.onTouchesMove).
  //
  // Handing over early is safe because the fresh session is already installed
  // below, before anything is awaited: openBlankPage's setText("") reaches the
  // new session, never the filed one, which keeps its own draft and retries on
  // its own.
  const finishCommit = useCallback(() => {
    const filed = sessionRef.current;
    if (!filed) {
      openBlankPage();
      return;
    }
    sessionRef.current = newSession();
    openBlankPage();

    void filed
      .commit()
      .then((path) => {
        if (path) {
          // Not a full refresh: see notes-store's noteFiled.
          void useNotesStore.getState().noteFiled(path).catch(() => {});
        }
      })
      .catch(() => {});
  }, [newSession, openBlankPage]);

  // A worklet that outlives the render that created it must not hold a
  // per-render function. The commit spring's callback runs on the UI runtime
  // several hundred milliseconds after onEnd, and the UI runtime keeps the
  // remote-function handle it was serialized with for that whole time — so the
  // gestures capture these fixed proxies and reach the current closures
  // through refs instead.
  const finishCommitRef = useRef(finishCommit);
  finishCommitRef.current = finishCommit;
  const runFinishCommit = useCallback(() => finishCommitRef.current(), []);

  // ---- Scroll plumbing ------------------------------------------------------

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      offsetY.value = event.contentOffset.y;
      contentH.value = event.contentSize.height;
      viewportH.value = event.layoutMeasurement.height;
      // Surface the indicator while scrolling; let it fade shortly after.
      indicatorOpacity.value = 1;
      indicatorOpacity.value = withDelay(600, withTiming(0, { duration: 350 }));
    },
  });

  // Scroll anchoring runs through the ScrollView's own imperative scrollTo on
  // the JS thread. It must never go back to reanimated's `scrollTo` inside
  // runOnUI:
  //
  // A worklet scheduled onto the UI runtime runs on the iOS *main* thread, and
  // a JS exception there cannot be caught by any .catch, by the React error
  // boundary, or by anything else — Hermes turns it into throwPendingError ->
  // __cxa_throw -> std::terminate -> abort. Two TestFlight crash reports show
  // exactly that stack (0.2.3 build 2026081202: SIGABRT on
  // com.apple.main-thread, _dispatch_main_queue_drain ->
  // HermesRuntimeImpl::call -> throwPendingError), and these were the only
  // runOnUI calls in the app.
  //
  // runOnUI is also asynchronous — it batches through a microtask and then
  // dispatches — so a scrollTo queued during one layout pass can land after
  // the swipe has already re-committed the page with a whole screen less
  // content, i.e. against a shadow node that no longer matches. Nothing about
  // keeping the bottom pinned needs that kind of precision.
  const scrollToY = (y: number) => {
    scrollRef.current?.scrollTo({ y, animated: false });
  };

  // Scroll anchoring: when content grows while the view sits at (or near) the
  // bottom — typing at the end of the note — keep the bottom pinned so the
  // caret stays above the keyboard. Growth while reading higher up never
  // yanks the view down.
  const onContentSizeChange = (_width: number, contentHeight: number) => {
    const previous = prevContentHRef.current;
    prevContentHRef.current = contentHeight;
    contentH.value = contentHeight;
    const viewport = viewportHRef.current;
    if (viewport <= 0 || contentHeight <= viewport) {
      return;
    }
    const wasAtBottom =
      previous <= viewport || offsetY.value >= previous - viewport - 48;
    if (wasAtBottom) {
      scrollToY(contentHeight - viewport);
    }
  };

  // The viewport shrinks/grows as the keyboard padding animates; keep the
  // bottom pinned through that too (only when it was pinned before).
  const onScrollViewLayout = (event: LayoutChangeEvent) => {
    const previous = viewportHRef.current;
    const viewport = event.nativeEvent.layout.height;
    viewportHRef.current = viewport;
    viewportH.value = viewport;
    const content = prevContentHRef.current;
    if (viewport < previous && content > viewport) {
      const wasAtBottom = offsetY.value >= content - previous - 48;
      if (wasAtBottom) {
        scrollToY(content - viewport);
      }
    }
  };

  // ---- Gestures --------------------------------------------------------------

  // Swipe up → file the page. Manual activation, gated on live scroll
  // geometry: the pan claims the touch only once the note sits at its bottom
  // edge and the finger keeps moving up — so a long note scrolls first and
  // the same drag rolls into the page pull the moment it hits the end. While
  // the note is above the bottom, the arm point trails the finger, so the
  // extra pull needed once the edge arrives is always the same few px.
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const armY = useSharedValue(0);
  const dragBase = useSharedValue(0);
  // Latched once the drag is unmistakably upward; from then on the horizontal
  // verdict is not consulted, so late thumb wobble cannot lose the swipe.
  const verticalLatched = useSharedValue(false);
  // Did this touch start where the native back recognizer is still competing?
  // Decided at touch-down, because that is the only thing the native side looks
  // at either (see isInNativeBackBand).
  const startedInNativeBand = useSharedValue(true);
  // One back navigation per touch.
  const backTriggered = useSharedValue(false);

  // ---- Gesture trace (Settings -> Diagnostics) ------------------------------
  //
  // Off by default and mirrored into a shared value, so a touch never reads the
  // store and a disabled trace costs one boolean check per gesture. Everything
  // is accumulated on the UI thread and emitted once, in onFinalize.
  const traceEnabled = useSharedValue(false);
  const traceOn = useDiagnosticsStore((state) => state.diagnostics.traceGestures);
  useEffect(() => {
    traceEnabled.value = traceOn;
  }, [traceEnabled, traceOn]);

  const traceStartMs = useSharedValue(0);
  const traceMaxDx = useSharedValue(0);
  const traceMaxDy = useSharedValue(0);
  const traceActivated = useSharedValue(false);
  const traceFailedByVerdict = useSharedValue(false);
  const traceFailedToSync = useSharedValue(false);
  const traceBlocked = useSharedValue(false);
  const traceGotEnd = useSharedValue(false);
  const traceEndSuccess = useSharedValue(false);
  const traceFiled = useSharedValue(false);
  const traceMaxPull = useSharedValue(0);
  // onFinalize can fire twice for one touch: once when manager.fail() resolves
  // the handler, and again when the finger actually lifts. Without this guard
  // every handed-over touch showed up as two identical rows.
  const traceEmitted = useSharedValue(false);

  const runRecordAttempt = useCallback(
    (attempt: GestureAttempt) => recordGestureAttempt(attempt),
    []
  );

  // Below the native back band nothing else is going to pop the screen, so a
  // decisive rightward drag does it here. Not driven under the finger — the
  // native animated pop is the same one the band above gets interactively.
  const goBackToMenu = useCallback(() => {
    navigation.popTo("Menu");
  }, [navigation]);
  const goBackRef = useRef(goBackToMenu);
  goBackRef.current = goBackToMenu;
  const runGoBack = useCallback(() => goBackRef.current(), []);

  // Memoized, and every capture in the closures below is a stable identity —
  // shared values, the useAnimatedKeyboard ref, and the run* proxies. That is
  // not a micro-optimization: GestureDetector re-runs updateAttachedGestures on
  // every render (its effect depends on `props`), and an unmemoized gesture
  // makes it re-serialize all three closure graphs into the UI runtime on every
  // keystroke — including in the middle of the commit spring, whose callback
  // the runtime is still holding.
  const swipeToFile = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: -BACK_SWIPE_GUTTER })
        .manualActivation(true)
        .onTouchesDown((event, manager) => {
          const touch = event.allTouches[0];
          // iOS can deliver a terminal/cancel frame with no remaining touches.
          // Never dereference that sparse frame inside a worklet.
          if (!touch) {
            manager.fail();
            return;
          }
          touchStartX.value = touch.x;
          touchStartY.value = touch.y;
          armY.value = touch.y;
          verticalLatched.value = false;
          backTriggered.value = false;
          startedInNativeBand.value = isInNativeBackBand(
            touch.y,
            windowH.value
          );

          traceStartMs.value = Date.now();
          traceMaxDx.value = 0;
          traceMaxDy.value = 0;
          traceActivated.value = false;
          traceFailedByVerdict.value = false;
          traceFailedToSync.value = false;
          traceBlocked.value = false;
          traceGotEnd.value = false;
          traceEndSuccess.value = false;
          traceFiled.value = false;
          traceMaxPull.value = 0;
          traceEmitted.value = false;
        })
        .onTouchesMove((event, manager) => {
          const touch = event.allTouches[0];
          if (!touch) {
            manager.fail();
            return;
          }
          const dx = touch.x - touchStartX.value;
          const dy = touch.y - touchStartY.value;
          if (Math.abs(dx) > Math.abs(traceMaxDx.value)) {
            traceMaxDx.value = dx;
          }
          if (Math.abs(dy) > Math.abs(traceMaxDy.value)) {
            traceMaxDy.value = dy;
          }

          if (!verticalLatched.value) {
            if (isVerticalCommitted(dx, dy)) {
              // Unmistakably upward — stop arbitrating for this touch.
              verticalLatched.value = true;
            } else {
              const verdict = horizontalVerdict(dx, dy);
              if (verdict === "sync") {
                // Always give this one up: swipeToSync sits behind us in the
                // Race and cannot start until we resolve.
                traceFailedToSync.value = true;
                manager.fail();
                return;
              }
              if (verdict === "navigation") {
                if (startedInNativeBand.value) {
                  // The native pop is competing for this touch; hand it over.
                  // This is the only place failing is worth its cost.
                  traceFailedByVerdict.value = true;
                  manager.fail();
                  return;
                }
                if (!backTriggered.value) {
                  // Below the band the native recognizer was never offered
                  // this touch, so going back is ours to do.
                  backTriggered.value = true;
                  traceFailedByVerdict.value = true;
                  runOnJS(runGoBack)();
                  manager.fail();
                  return;
                }
              }
              // "undecided" stays ours. Failing is terminal for the whole
              // touch, and at the start of a swipe up dy is still ~0.
            }
          }
          if (transitioning.value) {
            // A filed page is still parked off-screen. Decline rather than
            // fail: the window is short, and a finger that arrives at its tail
            // should still be able to file once it clears.
            traceBlocked.value = true;
            armY.value = touch.y;
            return;
          }
          if (
            !isAtScrollBottom(offsetY.value, contentH.value, viewportH.value)
          ) {
            // Still scrolling — keep the arm point under the finger.
            armY.value = touch.y;
            return;
          }
          if (armY.value - touch.y > ACTIVATE_PULL) {
            traceActivated.value = true;
            manager.activate();
          }
        })
        .onStart((event) => {
          // Translation accumulated before activation belongs to the scroll;
          // the page follows 1:1 from the claim point on.
          dragBase.value = event.translationY;
        })
        .onUpdate((event) => {
          const pull = -(event.translationY - dragBase.value);
          const pageHeight = visiblePageHeight(
            windowH.value,
            keyboard.height.value
          );
          pageY.value = -Math.min(Math.max(pull, 0), pageHeight);
          if (pull > traceMaxPull.value) {
            traceMaxPull.value = pull;
          }
        })
        .onEnd((event, success) => {
          traceGotEnd.value = true;
          traceEndSuccess.value = success;
          // RNGH calls END on cancellation too, with success = false — when the
          // native back pan, a system sheet or the scroll takes the touch. The
          // leftover upward velocity would make that the committing branch, so
          // a gesture the user never finished would file a note.
          if (!success) {
            transitioning.value = false;
            pageY.value = withSpring(0, CANCEL_SPRING);
            return;
          }
          const pageHeight = visiblePageHeight(
            windowH.value,
            keyboard.height.value
          );
          if (shouldCommitFiling(pageY.value, pageHeight, event.velocityY)) {
            traceFiled.value = true;
            transitioning.value = true;
            pageY.value = withSpring(
              -pageHeight,
              { ...COMMIT_SPRING, velocity: event.velocityY },
              (finished) => {
                if (finished) {
                  runOnJS(runFinishCommit)();
                } else {
                  // Interrupted mid-flight. Only clear the flag — do NOT start
                  // another animation on pageY from in here.
                  //
                  // Assigning an animation to a shared value from inside that
                  // same value's animation callback re-enters cancellation,
                  // which invokes this callback again, which assigns again:
                  // recursion until "Maximum call stack size exceeded". In
                  // worklets 0.10 `runGuarded` is a bare `runSync` with no
                  // try/catch, so on the UI runtime (the iOS main thread) that
                  // RangeError escapes as a C++ exception -> std::terminate ->
                  // SIGABRT. That is the swipe-up crash, and it has been here
                  // unchanged since mobile-v0.2.2.
                  //
                  // Nothing is stranded by leaving pageY alone: the only way to
                  // interrupt an animation is to assign to the value, so
                  // whoever interrupted us already owns its target.
                  transitioning.value = false;
                }
              }
            );
          } else {
            pageY.value = withSpring(0, {
              ...CANCEL_SPRING,
              velocity: event.velocityY,
            });
          }
        })
        .onFinalize(() => {
          // Cancellation without onEnd (system claimed the touch): spring home.
          if (!transitioning.value && pageY.value !== 0) {
            pageY.value = withSpring(0, CANCEL_SPRING);
          }
          if (traceEnabled.value && !traceEmitted.value) {
            traceEmitted.value = true;
            // One hop per touch, after everything has resolved.
            runOnJS(runRecordAttempt)({
              at: Date.now(),
              startX: touchStartX.value,
              startY: touchStartY.value,
              maxDx: traceMaxDx.value,
              maxDy: traceMaxDy.value,
              maxPull: traceMaxPull.value,
              durationMs: Date.now() - traceStartMs.value,
              latchedVertical: verticalLatched.value,
              activated: traceActivated.value,
              failedByVerdict: traceFailedByVerdict.value,
              failedToSync: traceFailedToSync.value,
              blockedByTransitioning: traceBlocked.value,
              gotEnd: traceGotEnd.value,
              endSuccess: traceEndSuccess.value,
              filed: traceFiled.value,
              band: startedInNativeBand.value,
            });
          }
        }),
    [
      armY,
      backTriggered,
      contentH,
      dragBase,
      keyboard,
      offsetY,
      pageY,
      runFinishCommit,
      runGoBack,
      runRecordAttempt,
      startedInNativeBand,
      touchStartX,
      touchStartY,
      traceActivated,
      traceBlocked,
      traceEmitted,
      traceEnabled,
      traceEndSuccess,
      traceFailedByVerdict,
      traceFailedToSync,
      traceFiled,
      traceGotEnd,
      traceMaxDx,
      traceMaxDy,
      traceMaxPull,
      traceStartMs,
      transitioning,
      verticalLatched,
      viewportH,
      windowH,
    ]
  );

  // Quick pull-down at the very top of the note tucks the keyboard away.
  // This observer never activates — it dispatches the dismiss and fails, so
  // the note's own scroll (top bounce) keeps running untouched. Everywhere
  // else the ScrollView's interactive keyboardDismissMode covers it.
  //
  // Because it never activates it must not sit inside the Race: there it
  // would have had to wait for swipeToFile to fail, and swipeToFile only
  // fails on horizontal intent — so on a downward drag it stayed BEGAN and
  // this never ran at all. It is composed simultaneously instead, where it
  // can watch every touch without being able to take one.
  const escapeStartX = useSharedValue(0);
  const escapeStartY = useSharedValue(0);
  const escapeDone = useSharedValue(false);

  const keyboardEscape = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: -BACK_SWIPE_GUTTER })
        .manualActivation(true)
        .onTouchesDown((event, manager) => {
          if (transitioning.value) {
            manager.fail();
            return;
          }
          const touch = event.allTouches[0];
          if (!touch) {
            manager.fail();
            return;
          }
          escapeStartX.value = touch.x;
          escapeStartY.value = touch.y;
          escapeDone.value = false;
        })
        .onTouchesMove((event, manager) => {
          if (escapeDone.value) {
            return;
          }
          const touch = event.allTouches[0];
          if (!touch) {
            manager.fail();
            return;
          }
          const dx = touch.x - escapeStartX.value;
          const dy = touch.y - escapeStartY.value;
          if (horizontalVerdict(dx, dy) !== "undecided") {
            manager.fail();
            return;
          }
          if (dy < -10) {
            manager.fail();
            return;
          }
          if (
            keyboard.height.value > 60 &&
            offsetY.value <= TOP_SLACK &&
            dy > ESCAPE_DRAG
          ) {
            escapeDone.value = true;
            runOnJS(dismissKeyboard)();
            manager.fail();
          }
        }),
    [
      dismissKeyboard,
      escapeDone,
      escapeStartX,
      escapeStartY,
      keyboard,
      offsetY,
      transitioning,
    ]
  );

  // Sync sits to the right of Capture. A clearly-leftward drag pulls in a
  // lightweight replica of its native header, with the current page moving
  // in parallax underneath. Once committed, the real Sync screen is pushed
  // with animation disabled so there is no second transition.
  const syncProgress = useSharedValue(0);

  const openSyncBehindPreview = useCallback(() => {
    navigation.navigate("Sync", { instant: true });
    // `animation: none` has no reliable attached callback. Keep the preview
    // for long enough to cover the mount, then park it off-screen again.
    setTimeout(() => {
      syncProgress.value = 0;
    }, 400);
  }, [navigation, syncProgress]);

  const openSyncRef = useRef(openSyncBehindPreview);
  openSyncRef.current = openSyncBehindPreview;
  const runOpenSync = useCallback(() => openSyncRef.current(), []);

  const swipeToSync = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: -BACK_SWIPE_GUTTER })
        .activeOffsetX(-24)
        .failOffsetX(SYNC_RIGHTWARD_FAIL)
        .failOffsetY([-24, 24])
        .onTouchesDown((_event, manager) => {
          // Never leave for Sync while a filed page is parked off-screen and
          // the commit spring is still running. Failing is cheap here: this
          // gesture sits behind swipeToFile in the Race, so giving it up costs
          // the swipe up nothing.
          if (transitioning.value) {
            manager.fail();
          }
        })
        .onStart(() => {
          runOnJS(dismissKeyboard)();
        })
        .onUpdate((event) => {
          syncProgress.value = Math.min(
            1,
            Math.max(0, -event.translationX / Math.max(windowW.value, 1))
          );
        })
        .onEnd((event, success) => {
          if (!success) {
            syncProgress.value = withTiming(0, { duration: 180 });
            return;
          }
          const shouldOpen =
            syncProgress.value > SYNC_OPEN_PROGRESS ||
            event.velocityX < SYNC_OPEN_VELOCITY;
          if (shouldOpen) {
            syncProgress.value = withTiming(
              1,
              { duration: 160, easing: Easing.out(Easing.cubic) },
              (finished) => {
                if (finished) {
                  runOnJS(runOpenSync)();
                }
              }
            );
          } else {
            syncProgress.value = withTiming(0, { duration: 180 });
          }
        }),
    [dismissKeyboard, runOpenSync, syncProgress, transitioning, windowW]
  );

  const captureGestures = useMemo(
    () =>
      Gesture.Simultaneous(
        keyboardEscape,
        Gesture.Race(swipeToFile, swipeToSync)
      ),
    [keyboardEscape, swipeToFile, swipeToSync]
  );

  // ---- Animated styles --------------------------------------------------------

  const syncDepthStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -width * SYNC_PARALLAX * syncProgress.value }],
  }));
  const syncDimStyle = useAnimatedStyle(() => ({
    opacity: 0.08 * syncProgress.value,
  }));
  const syncPreviewStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: width * (1 - syncProgress.value) }],
    opacity: syncProgress.value > 0 ? 1 : 0,
  }));

  // The page rides the swipe and its bottom padding tracks the keyboard so
  // the caret is never covered.
  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pageY.value }],
    paddingBottom: keyboard.height.value,
  }));

  // The fresh page enters from the bottom of the *visible* area — with the
  // keyboard up that's the keyboard's top edge, so it never hides behind it.
  const ghostStyle = useAnimatedStyle(() => {
    const pageHeight = Math.max(1, height - keyboard.height.value);
    return {
      transform: [{ translateY: pageY.value + pageHeight }],
      paddingBottom: keyboard.height.value,
    };
  });

  // Custom scroll indicator: a hair of a bar a few tints off the background,
  // visible only while scrolling. (The native one can't be styled on a
  // TextInput/ScrollView beyond black/white, so it's hidden and redrawn.)
  const indicatorStyle = useAnimatedStyle(() => {
    const track = viewportH.value;
    const content = Math.max(contentH.value, 1);
    if (content <= track + 8 || track <= 0) {
      return { opacity: 0, height: 0, transform: [{ translateY: 0 }] };
    }
    const barHeight = Math.min(track, Math.max(28, (track * track) / content));
    const progress = Math.min(Math.max(offsetY.value / (content - track), 0), 1);
    return {
      opacity: indicatorOpacity.value,
      height: barHeight,
      transform: [{ translateY: progress * (track - barHeight) }],
    };
  });

  const toolbarStyle = useAnimatedStyle(() => ({
    opacity: iconsOpacity.value,
  }));
  // The dictation FAB floats close above the keyboard when it's up, and at
  // its resting spot above the home indicator when it's not.
  const fabStyle = useAnimatedStyle(() => ({
    opacity: iconsOpacity.value * micOpacity.value,
    transform: [
      {
        translateY: Math.min(
          0,
          insets.bottom + 36 - keyboard.height.value - 12
        ),
      },
    ],
  }));

  const onChange = (value: string) => {
    setText(value);
    sessionRef.current?.onChange(value);
    // Keep the page uncluttered while writing; tapping back into the text
    // brings the buttons back. While a dictation is running the stop button
    // must stay reachable, so nothing fades.
    if (iconsVisible && !recordingActive) {
      hideIcons();
    }
  };

  // Dictation is the alternative to typing a page, so the mic only shows on
  // a blank page (or while a recording is running and must stay stoppable).
  // It fades instead of unmounting — see micOpacity.
  const micAvailable = text.trim().length === 0 || recordingActive;
  useEffect(() => {
    micOpacity.value = withTiming(micAvailable ? 1 : 0, { duration: 180 });
  }, [micAvailable, micOpacity]);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Animated.View style={[styles.depth, syncDepthStyle]}>
        <GestureDetector gesture={captureGestures}>
          <View style={styles.gestureHost} collapsable={false}>
            <Animated.View
              style={[
                styles.page,
                {
                  backgroundColor: theme.colors.background,
                  paddingTop: insets.top + 12,
                },
                pageStyle,
              ]}
            >
              <Animated.ScrollView
                ref={scrollRef}
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                onScroll={onScroll}
                scrollEventThrottle={16}
                onContentSizeChange={onContentSizeChange}
                onLayout={onScrollViewLayout}
                keyboardDismissMode="interactive"
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                directionalLockEnabled
                alwaysBounceVertical
              >
                <TextInput
                  ref={inputRef}
                  style={[
                    styles.input,
                    {
                      color: theme.colors.text,
                      fontSize: theme.fontSize,
                      lineHeight: theme.lineHeight,
                      fontFamily: theme.fontFamily,
                    },
                  ]}
                  value={text}
                  onChangeText={onChange}
                  onPressIn={showIcons}
                  placeholder={PLACEHOLDER}
                  placeholderTextColor={theme.colors.secondaryText}
                  multiline
                  scrollEnabled={false}
                  textAlignVertical="top"
                  keyboardAppearance={theme.dark ? "dark" : "light"}
                />
              </Animated.ScrollView>
              <View pointerEvents="none" style={styles.indicatorTrack}>
                <Animated.View
                  style={[
                    styles.indicator,
                    {
                      backgroundColor: theme.dark
                        ? "rgba(255,255,255,0.09)"
                        : "rgba(0,0,0,0.09)",
                    },
                    indicatorStyle,
                  ]}
                />
              </View>
            </Animated.View>

            {/* The incoming blank page trails exactly one visible-page
                height below the current one. The real input is cleared only
                while this ghost fully covers it, avoiding a text flash. */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.ghost,
                {
                  backgroundColor: theme.colors.background,
                  borderTopColor: theme.colors.border,
                  paddingTop: insets.top + 12 + 44,
                },
                ghostStyle,
              ]}
            >
              <Text
                style={{
                  color: theme.colors.secondaryText,
                  // Must track the real input, or the incoming page's
                  // placeholder would not land where the caret will.
                  fontSize: theme.fontSize,
                  lineHeight: theme.lineHeight,
                  fontFamily: theme.fontFamily,
                }}
              >
                {PLACEHOLDER}
              </Text>
            </Animated.View>
          </View>
        </GestureDetector>

        <Animated.View
          pointerEvents={iconsVisible ? "auto" : "none"}
          style={[styles.toolbarLeft, { top: insets.top + 8 }, toolbarStyle]}
        >
          <ToolbarButton
            icon="menu-outline"
            // Menu is the root immediately beneath Capture. popTo avoids
            // accidentally pushing a duplicate Menu screen.
            onPress={() => navigation.popTo("Menu")}
          />
        </Animated.View>
        <SyncStatusLabel top={insets.top + 18} />
        <Animated.View
          pointerEvents={iconsVisible && micAvailable ? "auto" : "none"}
          style={[styles.fab, { bottom: insets.bottom + 36 }, fabStyle]}
        >
          <DictationButton onRecordingChange={setRecordingActive} />
        </Animated.View>
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.syncDim, syncDimStyle]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.syncPreview,
          { backgroundColor: theme.colors.background },
          syncPreviewStyle,
        ]}
      >
        <View style={{ paddingTop: insets.top }}>
          <View style={styles.syncPreviewBar}>
            <Ionicons
              name="chevron-back"
              size={26}
              color={theme.colors.text}
              style={styles.syncPreviewBack}
            />
            <Text style={[styles.syncPreviewTitle, { color: theme.colors.text }]}>
              Sync
            </Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  depth: { flex: 1 },
  syncDim: { backgroundColor: "#000" },
  syncPreview: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    shadowColor: "#000",
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  // Replica of the native-stack Sync header used only during the interactive
  // preview; the real screen takes over after the no-animation push.
  syncPreviewBar: { height: 44, alignItems: "center", justifyContent: "center" },
  syncPreviewBack: { position: "absolute", left: 8, top: 9 },
  syncPreviewTitle: { fontSize: 17, fontWeight: "600" },
  gestureHost: { flex: 1 },
  page: { flex: 1, paddingHorizontal: 20 },
  scroll: { flex: 1 },
  // flexGrow (not flex) so the input fills the viewport at minimum but the
  // container still grows with the input's content beyond it.
  scrollContent: { flexGrow: 1 },
  // fontSize/lineHeight come from the theme (Settings → Appearance).
  input: {
    flexGrow: 1,
    paddingTop: 44,
    paddingBottom: 24,
  },
  // The custom scroll indicator's rail, pinned to the scroll area's right
  // edge (absolute children respect the page's animated bottom padding).
  indicatorTrack: {
    position: "absolute",
    top: 4,
    bottom: 4,
    right: 2,
    width: 3,
  },
  indicator: {
    width: 3,
    borderRadius: 2,
  },
  // The incoming page: full-screen, with a paper edge (hairline + soft
  // shadow) so it reads as a sheet sliding in on the same background.
  ghost: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
  },
  fab: {
    position: "absolute",
    right: 32,
    alignItems: "flex-end",
  },
  toolbarLeft: {
    position: "absolute",
    left: 20,
    flexDirection: "row",
  },
  syncStatus: {
    position: "absolute",
    right: 20,
  },
});
