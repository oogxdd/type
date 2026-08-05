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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  type LayoutChangeEvent,
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
  runOnUI,
  scrollTo,
  useAnimatedKeyboard,
  useAnimatedRef,
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
import { useClearInstantParam, type RootStackParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { useTheme } from "../theme";
import { DictationButton } from "../ui/dictation-button";
import { ToolbarButton } from "../ui/toolbar-button";

// Releasing past this fraction of the visible page height commits the swipe;
// a faster upward flick commits regardless of distance.
const COMMIT_FRACTION = 0.2;
const COMMIT_VELOCITY = -550;
// How far past the arm point (the bottom edge) the finger must travel before
// the pan claims the touch from the scroll — small enough to feel instant,
// big enough to ignore jitter.
const ACTIVATE_PULL = 6;
// Reserve the standard iOS back-swipe edge exclusively for native-stack
// navigation. Capture gestures do not even begin inside this gutter.
const BACK_SWIPE_GUTTER = 48;
// Outside the gutter, vertical observers still fail as soon as horizontal
// intent is clear so the navigator does not wait behind a BEGAN handler.
const HORIZONTAL_FAIL = 8;
// Scroll-edge slack (px): treat "within a few px" as at the edge.
const BOTTOM_SLACK = 6;
const TOP_SLACK = 4;
// Pull-down at the top of the note that tucks the keyboard away.
const ESCAPE_DRAG = 14;

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
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();

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

  // 0..-V — how far the current page has slid up (V = visible page height).
  const pageY = useSharedValue(0);
  // True from commit-release until the fresh page has swapped in.
  const transitioning = useSharedValue(false);

  const indicatorOpacity = useSharedValue(0);

  const session = useMemo(
    () =>
      new CaptureSession({
        createNote: async (content) => {
          const { path } = await core.createNote({ content });
          void core.requestObjectSync("capture").catch(() => {});
          return path;
        },
        writeNote: async (path, content) => {
          await core.writeNote(path, content);
          // The scheduler coalesces and rate-limits, so nudging it on every
          // write is cheap, and it does nothing unless cloud sync is set up.
          // Never awaited: capture must not wait on the network.
          void core.requestObjectSync("capture").catch(() => {});
        },
        deleteNote: async (path) => {
          await core.deleteItems([path]);
          void core.requestObjectSync("capture").catch(() => {});
        },
      }),
    []
  );

  // Stack navigation emits blur for Menu, Sync, and all pushed destinations.
  // Flush before this capture screen becomes hidden or is popped.
  useEffect(
    () =>
      navigation.addListener("blur", () => {
        // Navigation should never turn a storage rejection into a fatal,
        // unhandled JS error. CaptureSession keeps the draft dirty for retry.
        void session.flush().catch(() => {});
      }),
    [navigation, session]
  );

  // Menu's finger-driven preview can attach Capture with animation disabled;
  // clear that one-shot flag once mounted so later native back gestures work.
  useClearInstantParam();

  // Wrap Keyboard.dismiss so the worklet captures this plain closure rather
  // than the bare method — passing Keyboard.dismiss straight to runOnJS makes
  // worklets try to copy its owner (KeyboardImpl), which it can't serialize.
  const dismissKeyboard = () => Keyboard.dismiss();

  const showIcons = () => {
    setIconsVisible(true);
    iconsOpacity.value = withTiming(1, { duration: 180 });
  };

  const hideIcons = () => {
    setIconsVisible(false);
    iconsOpacity.value = withTiming(0, { duration: 180 });
  };

  // The committed page is off-screen (the ghost covers the viewport). Wait
  // for persistence before exposing the fresh page: this prevents new typing
  // from racing the old note's commit and lets a failed write spring the
  // original page back instead of losing it or surfacing a fatal rejection.
  const finishCommit = () => {
    void session
      .commit()
      .then((path) => {
        if (path) {
          void useNotesStore.getState().refresh().catch(() => {});
        }
        setText("");
        prevContentHRef.current = 0;
        offsetY.value = 0;
        // No scrollTo here. The fresh page's content is empty, so the reused
        // ScrollView is already at the top. Calling reanimated's scrollTo on
        // the UI thread as the content collapses to empty threw an uncaught
        // worklet error on the main thread (Hermes throwPendingError ->
        // std::terminate -> SIGABRT) — that was the swipe-up-to-file crash.
        showIcons();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            pageY.value = 0;
            transitioning.value = false;
          })
        );
      })
      .catch(() => {
        transitioning.value = false;
        pageY.value = withSpring(0, CANCEL_SPRING);
      });
  };

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
      runOnUI(() => {
        scrollTo(scrollRef, 0, contentHeight - viewport, false);
      })();
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
        runOnUI(() => {
          scrollTo(scrollRef, 0, content - viewport, false);
        })();
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

  const swipeToFile = Gesture.Pan()
    .hitSlop({ left: -BACK_SWIPE_GUTTER })
    .manualActivation(true)
    .onTouchesDown((event, manager) => {
      if (transitioning.value) {
        manager.fail();
        return;
      }
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
    })
    .onTouchesMove((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch) {
        manager.fail();
        return;
      }
      const dx = touch.x - touchStartX.value;
      const dy = touch.y - touchStartY.value;
      // Clearly-horizontal drags belong to native back or the Sync push.
      if (Math.abs(dx) > HORIZONTAL_FAIL && Math.abs(dx) > Math.abs(dy)) {
        manager.fail();
        return;
      }
      const maxScroll = Math.max(0, contentH.value - viewportH.value);
      const atBottom = offsetY.value >= maxScroll - BOTTOM_SLACK;
      if (!atBottom) {
        // Still scrolling — keep the arm point under the finger.
        armY.value = touch.y;
        return;
      }
      if (armY.value - touch.y > ACTIVATE_PULL) {
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
      const pageHeight = Math.max(1, height - keyboard.height.value);
      pageY.value = -Math.min(Math.max(pull, 0), pageHeight);
    })
    .onEnd((event) => {
      const pageHeight = Math.max(1, height - keyboard.height.value);
      const shouldCommit =
        -pageY.value > pageHeight * COMMIT_FRACTION ||
        event.velocityY < COMMIT_VELOCITY;
      if (shouldCommit) {
        transitioning.value = true;
        pageY.value = withSpring(
          -pageHeight,
          { ...COMMIT_SPRING, velocity: event.velocityY },
          (finished) => {
            if (finished) {
              runOnJS(finishCommit)();
            } else {
              // Interrupted mid-flight (unmount, new gesture) — don't leave
              // the page stranded off-screen without a swap.
              transitioning.value = false;
              pageY.value = withSpring(0, CANCEL_SPRING);
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
    });

  // Quick pull-down at the very top of the note tucks the keyboard away.
  // This observer never activates — it dispatches the dismiss and fails, so
  // the note's own scroll (top bounce) keeps running untouched. Everywhere
  // else the ScrollView's interactive keyboardDismissMode covers it.
  const escapeStartX = useSharedValue(0);
  const escapeStartY = useSharedValue(0);
  const escapeDone = useSharedValue(false);

  const keyboardEscape = Gesture.Pan()
    .hitSlop({ left: -BACK_SWIPE_GUTTER })
    .manualActivation(true)
    .onTouchesDown((event, manager) => {
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
      if (Math.abs(dx) > HORIZONTAL_FAIL && Math.abs(dx) > Math.abs(dy)) {
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
    });

  // Sync sits to the right of Capture. A clearly-leftward drag pulls in a
  // lightweight replica of its native header, with the current page moving
  // in parallax underneath. Once committed, the real Sync screen is pushed
  // with animation disabled so there is no second transition.
  const syncProgress = useSharedValue(0);

  const openSyncBehindPreview = () => {
    navigation.navigate("Sync", { instant: true });
    // `animation: none` has no reliable attached callback. Keep the preview
    // for long enough to cover the mount, then park it off-screen again.
    setTimeout(() => {
      syncProgress.value = 0;
    }, 400);
  };

  const swipeToSync = Gesture.Pan()
    .hitSlop({ left: -BACK_SWIPE_GUTTER })
    .activeOffsetX(-24)
    .failOffsetX(HORIZONTAL_FAIL)
    .failOffsetY([-24, 24])
    .onStart(() => {
      runOnJS(dismissKeyboard)();
    })
    .onUpdate((event) => {
      syncProgress.value = Math.min(
        1,
        Math.max(0, -event.translationX / Math.max(width, 1))
      );
    })
    .onEnd((event) => {
      const shouldOpen =
        syncProgress.value > SYNC_OPEN_PROGRESS ||
        event.velocityX < SYNC_OPEN_VELOCITY;
      if (shouldOpen) {
        syncProgress.value = withTiming(
          1,
          { duration: 160, easing: Easing.out(Easing.cubic) },
          (finished) => {
            if (finished) {
              runOnJS(openSyncBehindPreview)();
            }
          }
        );
      } else {
        syncProgress.value = withTiming(0, { duration: 180 });
      }
    });

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
    opacity: iconsOpacity.value,
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
    session.onChange(value);
    // Keep the page uncluttered while writing; tapping back into the text
    // brings the buttons back. While a dictation is running the stop button
    // must stay reachable, so nothing fades.
    if (iconsVisible && !recordingActive) {
      hideIcons();
    }
  };

  // Dictation is the alternative to typing a page, so the mic only shows on
  // a blank page (or while a recording is running and must stay stoppable).
  const micAvailable = text.trim().length === 0 || recordingActive;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Animated.View style={[styles.depth, syncDepthStyle]}>
        <GestureDetector
          gesture={Gesture.Race(swipeToFile, keyboardEscape, swipeToSync)}
        >
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
                  style={[styles.input, { color: theme.colors.text }]}
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
                style={[
                  styles.ghostPlaceholder,
                  { color: theme.colors.secondaryText },
                ]}
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
        {micAvailable ? (
          <Animated.View
            pointerEvents={iconsVisible ? "auto" : "none"}
            style={[styles.fab, { bottom: insets.bottom + 36 }, fabStyle]}
          >
            <DictationButton onRecordingChange={setRecordingActive} />
          </Animated.View>
        ) : null}
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
  input: {
    flexGrow: 1,
    fontSize: 17,
    lineHeight: 26,
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
  ghostPlaceholder: {
    fontSize: 17,
    lineHeight: 26,
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
});
