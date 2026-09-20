// Capture keeps its draft mounted while the menu is open. HomeScreen owns
// direction/release; this native scroll view supplies only bottom overscroll.

import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  type LayoutChangeEvent,
  type ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedProps,
  useAnimatedReaction,
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
import { collectNotePaths } from "../lib/feed";
import { registerCaptureDraft } from "../lib/capture-draft";
import {
  isPullReady,
  overscrollPastEnd,
  PULL_REVEAL,
  PULL_TAB_HEIGHT,
  visiblePageHeight,
} from "../lib/capture-gesture";
import * as Haptics from "expo-haptics";
import { autoSyncLabel } from "../lib/sync-experience";
import { type RootStackParamList } from "../navigation";
import { useDiagnosticsStore } from "../state/diagnostics-store";
import { useNotesStore } from "../state/notes-store";
import { useSyncStore } from "../state/sync-store";
import { useTheme } from "../theme";
import { DictationButton } from "../ui/dictation-button";
import { ToolbarButton } from "../ui/toolbar-button";
import { useHomeShell } from "./home-shell";

const PLACEHOLDER = "Start typing…";

const COMMIT_SPRING = {
  damping: 34,
  stiffness: 320,
  overshootClamping: true,
} as const;
const thresholdHaptic = () => { void Haptics.selectionAsync().catch(() => {}); };

// Keep sync status updates local to this label.
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
  const { height } = useWindowDimensions();
  const {
    menuVisible, menuProgress, direction, dragging, pull, pullReady,
    transitioning, commitRequest, captureScroll, openMenu, suppressPressUntil,
  } = useHomeShell();
  const [readyLabel, setReadyLabel] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [restoring, setRestoring] = useState(false);

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
  useEffect(() => {
    windowH.value = height;
  }, [height, windowH]);

  // 0..-V — how far the current page has slid up (V = visible page height).
  const pageY = useSharedValue(0);

  const indicatorOpacity = useSharedValue(0);

  // One session per page, not one per screen: filing hands the finished page's
  // session off to storage and the fresh page starts on its own, so a keystroke
  // that lands while the previous write is still in flight can never be folded
  // into the note being filed.
  const newSession = useCallback(
    (initial?: { path: string; content: string }) =>
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
      }, undefined, initial),
    []
  );
  const sessionRef = useRef<CaptureSession | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = newSession();
  }

  const persistDraft = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    await session.flush();
    const path = session.currentPath();
    if (path) await useNotesStore.getState().noteFiled(path);
  }, []);
  const flushDraft = useCallback(() => { void persistDraft().catch(() => {}); }, [persistDraft]);
  useEffect(() => registerCaptureDraft(persistDraft), [persistDraft]);
  useEffect(() => navigation.addListener("blur", flushDraft), [navigation, flushDraft]);
  useEffect(() => { if (menuVisible) flushDraft(); }, [menuVisible, flushDraft]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") flushDraft();
    });
    return () => { subscription.remove(); flushDraft(); };
  }, [flushDraft]);

  // Menu actions may edit, move or delete the saved draft. Reconcile it when
  // returning, so the persistent input cannot overwrite an edit made in Editor.
  const wasMenuVisible = useRef(menuVisible);
  useEffect(() => {
    const returning = wasMenuVisible.current && !menuVisible;
    wasMenuVisible.current = menuVisible;
    if (!returning) return;
    const session = sessionRef.current;
    if (!session?.currentPath()) return;
    let cancelled = false;
    setRestoring(true);
    transitioning.value = true;
    void (async () => {
      await session.flush();
      const path = session.currentPath();
      if (!path) return;
      const tree = await core.getTree();
      const exists = collectNotePaths(tree).includes(path);
      const content = exists ? await core.readNote(path) : "";
      if (cancelled || sessionRef.current !== session) return;
      sessionRef.current = newSession(exists ? { path, content } : undefined);
      setText(content);
    })().catch(() => {
      if (!cancelled) Alert.alert("Could not reload note", "Your draft is still here. Try opening it again.");
    }).finally(() => {
      if (!cancelled) { setRestoring(false); transitioning.value = false; }
    });
    return () => { cancelled = true; transitioning.value = false; };
  }, [menuVisible, newSession, transitioning]);

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
    pull.value = 0;
    pullReady.value = false;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    setCommitting(false);
    showIcons();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        pageY.value = 0;
        transitioning.value = false;
        inputRef.current?.focus();
      })
    );
  }, [offsetY, pageY, showIcons, transitioning, pull, pullReady]);

  // Keep the old draft until storage succeeds. Failure restores the page,
  // rather than abandoning a dirty session behind a fresh empty input.
  const finishCommit = useCallback(() => {
    const filed = sessionRef.current;
    if (!filed) return;
    void filed.commit().then((path) => {
      sessionRef.current = newSession();
      openBlankPage();
      if (path) void useNotesStore.getState().noteFiled(path).catch(() => {});
    }).catch(() => {
      setCommitting(false);
      transitioning.value = false;
      pageY.value = withTiming(0, { duration: 220 });
      Alert.alert("Could not save note", "Your text is still here. Try again before starting a new note.");
    });
  }, [newSession, openBlankPage, pageY, transitioning]);

  // A worklet that outlives the render that created it must not hold a
  // per-render function. The commit spring's callback runs on the UI runtime
  // several hundred milliseconds after onEnd, and the UI runtime keeps the
  // remote-function handle it was serialized with for that whole time — so the
  // gestures capture these fixed proxies and reach the current closures
  // through refs instead.
  const finishCommitRef = useRef(finishCommit);
  finishCommitRef.current = finishCommit;
  const runFinishCommit = useCallback(() => finishCommitRef.current(), []);

  useAnimatedReaction(() => commitRequest.value, (request, previous) => {
    if (previous === null || request === previous) return;
    runOnJS(setCommitting)(true);
    pageY.value = withSpring(-visiblePageHeight(windowH.value, keyboard.height.value),
      COMMIT_SPRING, (finished) => { if (finished) runOnJS(runFinishCommit)(); });
  });
  useAnimatedReaction(() => pullReady.value, (ready, previous) => {
    if (ready === previous) return;
    runOnJS(setReadyLabel)(ready);
    if (ready) runOnJS(thresholdHaptic)();
  });
  const scrollProps = useAnimatedProps(() => ({
    scrollEnabled: !transitioning.value &&
      !(dragging.value && (direction.value === "left" || direction.value === "right")),
  }));

  // ---- Scroll plumbing ------------------------------------------------------

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      offsetY.value = event.contentOffset.y;
      contentH.value = event.contentSize.height;
      viewportH.value = event.layoutMeasurement.height;
      // Momentum, keyboard resizing and programmatic scrolls cannot arm it.
      if (dragging.value && direction.value === "up" && menuProgress.value < 0.001 && !transitioning.value) {
        pull.value = overscrollPastEnd(event.contentOffset.y, event.contentSize.height, event.layoutMeasurement.height);
        pullReady.value = isPullReady(pull.value, pullReady.value);
      }
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

  const pullPillStyle = useAnimatedStyle(() => ({
    bottom: Math.max(keyboard.height.value, insets.bottom) + 8,
    opacity: transitioning.value ? 0 : Math.min(1, Math.max(0, (pull.value - PULL_REVEAL) / 16)),
    transform: [{ translateY: PULL_TAB_HEIGHT + 12 - Math.min(Math.max(0, pull.value - PULL_REVEAL), 150) }],
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
      <View style={styles.depth}>
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
              <GestureDetector gesture={captureScroll}>
              <Animated.ScrollView
                animatedProps={scrollProps}
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
                  editable={!committing && !restoring && !menuVisible}
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
              </GestureDetector>
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

        <Animated.View
          pointerEvents={iconsVisible ? "auto" : "none"}
          style={[styles.toolbarLeft, { top: insets.top + 8 }, toolbarStyle]}
        >
          <ToolbarButton
            icon="menu-outline"
            onPress={() => { if (Date.now() >= suppressPressUntil.value) openMenu(); }}
          />
        </Animated.View>
        <SyncStatusLabel top={insets.top + 18} />
        <Animated.View
          pointerEvents={iconsVisible && micAvailable ? "auto" : "none"}
          style={[styles.fab, { bottom: insets.bottom + 36 }, fabStyle]}
        >
          <DictationButton onRecordingChange={setRecordingActive} />
        </Animated.View>
      </View>
      <Animated.View pointerEvents="none" style={[
        styles.pullPill,
        { backgroundColor: theme.colors.surface, borderColor: readyLabel ? theme.colors.text : theme.colors.border },
        pullPillStyle,
      ]}>
        <Ionicons name={readyLabel ? "add-outline" : "arrow-up-outline"} size={18} color={theme.colors.text} />
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.text, fontSize: 13 }}>
          {readyLabel ? "Release to start a new note" : "Pull up for a new note"}
        </Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  depth: { flex: 1 },
  pullPill: {
    position: "absolute", alignSelf: "center", minHeight: PULL_TAB_HEIGHT,
    paddingHorizontal: 16, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
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
