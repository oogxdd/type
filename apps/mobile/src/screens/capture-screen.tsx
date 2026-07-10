// The home screen and the app's signature interaction: a blank page you can
// type on immediately. Swiping up files the page away (the note slides off the
// top) and a fresh blank page is ready underneath — same gesture as the
// original app. Notes land in Feed via the desktop-compatible core.
//
// This is the middle page of the Home pager (menu to the left, sync to the
// right) — the pager owns horizontal swipes natively, so the gestures here
// only claim clearly-vertical drags (direction- and position-separated so
// they don't fight the TextInput's own scroll):
//   swipe UP   → file the page + open a fresh one, but only once you've
//                scrolled the note to the BOTTOM. A rounded "tongue" stretches
//                from the bottom edge as you pull; past the arm threshold it
//                turns accent (release = commit).
//   swipe DOWN → dismiss the keyboard, but only when the note is at the TOP
//                (otherwise a downward drag scrolls the note up as usual).
// The keyboard never covers the caret: the page's bottom padding tracks the
// keyboard height (like Apple Notes) so the text always sits above it.

import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  TextInput,
  type TextInputScrollEventData,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as core from "@typenotes/mobile-core/core-api";

import { CaptureSession } from "../lib/capture";
import { jumpToHomePage, type RootStackParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { useTheme } from "../theme";
import { DictationButton } from "../ui/dictation-button";
import { ToolbarButton } from "../ui/toolbar-button";

// Flick velocity (px/s, upward) that files the page regardless of distance.
const SWIPE_VELOCITY = -900;

// The swipe-up "tongue": a rounded tab that stretches up from the bottom edge
// as you drag. It arms (turns accent, chevron flips to the filled state) once
// the drag passes ARM_PULL — release then files the page.
const TONGUE_WIDTH = 128;
const MAX_PULL = 88;
const ARM_PULL = 64;
// The page itself lifts a little as you pull, for a touch of physicality.
const PAGE_FOLLOW = 0.4;

export const CaptureScreen = ({ active = true }: { active?: boolean }) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { height } = useWindowDimensions();

  const [text, setText] = useState("");
  const [pageKey, setPageKey] = useState(0);
  const [iconsVisible, setIconsVisible] = useState(true);
  const [recordingActive, setRecordingActive] = useState(false);
  const iconsOpacity = useSharedValue(1);
  const inputRef = useRef<TextInput>(null);

  // The keyboard height (0 when hidden) as a UI-thread shared value; the page
  // padding and the floating controls ride it so nothing hides under the
  // keyboard.
  const keyboard = useAnimatedKeyboard();

  // Whether the note is scrolled to its top / bottom edge. A blank or
  // short note (nothing to scroll) is at both. These gate the vertical
  // gestures so switching-to-next and dismissing-keyboard don't fight the
  // note's own scrolling: you can only file the page from the bottom, and
  // only dismiss the keyboard from the top. Kept in refs too so onScroll
  // can flip them without re-reading state.
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const atTopRef = useRef(true);
  const atBottomRef = useRef(true);
  // The multiline input's onScroll only reports contentOffset, so its viewport
  // and content heights are tracked separately (onLayout / onContentSizeChange)
  // and combined to decide whether we're at an edge.
  const scrollYRef = useRef(0);
  const viewportHRef = useRef(0);
  const contentHRef = useRef(0);

  const session = useMemo(
    () =>
      new CaptureSession({
        createNote: async (content) => (await core.createNote({ content })).path,
        writeNote: core.writeNote,
        deleteNote: (path) => core.deleteItems([path]),
      }),
    []
  );

  // Flush the draft when the capture page stops being visible: paging away
  // inside the Home pager (`active` flips false — paging is not a navigation
  // event) and pushes above the pager (the Home screen blurs).
  useEffect(() => {
    if (!active) {
      void session.flush();
    }
  }, [active, session]);
  useEffect(
    () => navigation.addListener("blur", () => void session.flush()),
    [navigation, session]
  );

  // Keep the keyboard-visible flag current for the dismiss gesture's enabled
  // state (a JS boolean — the animated height above drives layout instead).
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true)
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const translateY = useSharedValue(0);
  // 0..MAX_PULL — how far the swipe-up tongue has stretched.
  const pull = useSharedValue(0);

  // Wrap Keyboard.dismiss so the worklet captures this plain closure rather
  // than the bare method — passing Keyboard.dismiss straight to runOnJS makes
  // worklets try to copy its owner (KeyboardImpl), which it can't serialize.
  const dismissKeyboard = () => Keyboard.dismiss();

  const resetScrollEdges = () => {
    scrollYRef.current = 0;
    contentHRef.current = 0;
    atTopRef.current = true;
    atBottomRef.current = true;
    setAtTop(true);
    setAtBottom(true);
  };

  const commitPage = () => {
    void session.commit().then((path) => {
      if (path) {
        void useNotesStore.getState().refresh();
      }
    });
    // Remount the input so the new blank page appears with no text flash.
    setText("");
    setPageKey((key) => key + 1);
    translateY.value = 0;
    pull.value = 0;
    resetScrollEdges();
    showIcons();
  };

  const showIcons = () => {
    setIconsVisible(true);
    iconsOpacity.value = withTiming(1, { duration: 180 });
  };

  const hideIcons = () => {
    setIconsVisible(false);
    iconsOpacity.value = withTiming(0, { duration: 180 });
  };

  // Recompute the scroll edges from the latest scroll offset + viewport/content
  // heights; only re-render when an edge flag flips so typing/scrolling stays
  // cheap. A note that fits its viewport is at both edges.
  const recomputeScrollEdges = () => {
    const scrollY = scrollYRef.current;
    const maxScroll = Math.max(0, contentHRef.current - viewportHRef.current);
    const top = scrollY <= 4;
    const bottom = scrollY >= maxScroll - 6;
    if (top !== atTopRef.current) {
      atTopRef.current = top;
      setAtTop(top);
    }
    if (bottom !== atBottomRef.current) {
      atBottomRef.current = bottom;
      setAtBottom(bottom);
    }
  };

  const onScroll = (event: NativeSyntheticEvent<TextInputScrollEventData>) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
    recomputeScrollEdges();
  };
  const onInputLayout = (event: LayoutChangeEvent) => {
    viewportHRef.current = event.nativeEvent.layout.height;
    recomputeScrollEdges();
  };
  const onContentSizeChange = (
    event: NativeSyntheticEvent<{ contentSize: { width: number; height: number } }>
  ) => {
    contentHRef.current = event.nativeEvent.contentSize.height;
    recomputeScrollEdges();
  };

  // A clear downward drag tucks the keyboard away (the input regains it on the
  // next tap). Gated to the top of the note + keyboard-up so a downward drag
  // elsewhere scrolls the note instead of stealing it.
  const dismissKeyboardPan = Gesture.Pan()
    .enabled(keyboardVisible && atTop)
    .activeOffsetY(18)
    .failOffsetY(-14)
    .failOffsetX([-30, 30])
    .onStart(() => {
      runOnJS(dismissKeyboard)();
    });

  // Swipe up to file the page + open a fresh one. Enabled only at the bottom of
  // the note so a partly-scrolled long note keeps scrolling under the finger;
  // once at the bottom, an upward drag stretches the tongue and, past the arm
  // threshold (or a fast flick), files the page.
  const swipeToFile = Gesture.Pan()
    .enabled(atBottom)
    // Only claim clearly-upward drags; leave taps and downward scrolling to
    // the text input, and mostly-horizontal drags to the pager's page swipe.
    .activeOffsetY([-18, Number.MAX_SAFE_INTEGER])
    .failOffsetX([-40, 40])
    .failOffsetY(14)
    .onUpdate((event) => {
      const dragUp = Math.max(0, -event.translationY);
      pull.value = Math.min(MAX_PULL, dragUp);
      translateY.value = -pull.value * PAGE_FOLLOW;
    })
    .onEnd((event) => {
      const armed = pull.value >= ARM_PULL || event.velocityY < SWIPE_VELOCITY;
      if (armed) {
        runOnJS(dismissKeyboard)();
        pull.value = withTiming(0, { duration: 200 });
        translateY.value = withTiming(-height, { duration: 220 }, (finished) => {
          if (finished) {
            runOnJS(commitPage)();
          }
        });
      } else {
        pull.value = withTiming(0, { duration: 160 });
        translateY.value = withSpring(0, { damping: 20, stiffness: 300 });
      }
    });

  // The page follows the finger a little and its bottom padding tracks the
  // keyboard so the caret is never covered.
  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    paddingBottom: keyboard.height.value,
  }));

  const toolbarStyle = useAnimatedStyle(() => ({
    opacity: iconsOpacity.value,
  }));
  // The dictation FAB floats just above the keyboard when it's up.
  const fabStyle = useAnimatedStyle(() => ({
    opacity: iconsOpacity.value,
    transform: [{ translateY: -keyboard.height.value }],
  }));

  // The tongue: a rounded tab whose height is the pull distance, anchored just
  // above the keyboard (or the safe-area bottom). It fills toward accent and
  // pops as it arms.
  const tongueTrackStyle = useAnimatedStyle(() => ({
    bottom: Math.max(keyboard.height.value, insets.bottom) + 6,
    opacity: pull.value > 1 ? 1 : 0,
  }));
  const tongueStyle = useAnimatedStyle(() => ({
    height: pull.value,
    backgroundColor: interpolateColor(
      pull.value,
      [ARM_PULL - 16, ARM_PULL],
      [theme.colors.surface, theme.colors.accent]
    ),
    borderColor: interpolateColor(
      pull.value,
      [ARM_PULL - 16, ARM_PULL],
      [theme.colors.border, theme.colors.accent]
    ),
    transform: [
      {
        scale: interpolate(
          pull.value,
          [ARM_PULL - 16, ARM_PULL],
          [1, 1.06],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));
  const chevronRestStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      pull.value,
      [ARM_PULL - 16, ARM_PULL],
      [1, 0],
      Extrapolation.CLAMP
    ),
  }));
  const chevronArmedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      pull.value,
      [ARM_PULL - 16, ARM_PULL],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }));

  const onChange = (value: string) => {
    setText(value);
    session.onChange(value);
    // Keep the page uncluttered while writing; tapping back into the text
    // brings the hamburger/mic buttons back. While a dictation is running the
    // stop button must stay reachable, so nothing fades.
    if (iconsVisible && !recordingActive) {
      hideIcons();
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <GestureDetector gesture={Gesture.Race(swipeToFile, dismissKeyboardPan)}>
        <Animated.View
          style={[
            styles.page,
            { backgroundColor: theme.colors.background, paddingTop: insets.top + 12 },
            pageStyle,
          ]}
        >
          <TextInput
            key={pageKey}
            ref={inputRef}
            style={[styles.input, { color: theme.colors.text }]}
            value={text}
            onChangeText={onChange}
            onPressIn={showIcons}
            onScroll={onScroll}
            onLayout={onInputLayout}
            onContentSizeChange={onContentSizeChange}
            placeholder="Start typing…"
            placeholderTextColor={theme.colors.secondaryText}
            multiline
            scrollEnabled
            textAlignVertical="top"
            keyboardAppearance={theme.dark ? "dark" : "light"}
          />
          {/* "swipe up for a new page" hint hidden per feedback — the gesture
              still works, we just don't want to show the label. */}
        </Animated.View>
      </GestureDetector>

      {/* The swipe-up tongue: stretches from the bottom edge as you pull, and
          turns accent once it's armed to file the page. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.tongueTrack, tongueTrackStyle]}
      >
        <Animated.View style={[styles.tongue, tongueStyle]}>
          <Animated.View style={[styles.chevron, chevronRestStyle]}>
            <Ionicons
              name="chevron-up"
              size={22}
              color={theme.colors.secondaryText}
            />
          </Animated.View>
          <Animated.View style={[styles.chevron, chevronArmedStyle]}>
            <Ionicons name="chevron-up" size={22} color="#ffffff" />
          </Animated.View>
        </Animated.View>
      </Animated.View>

      <Animated.View
        pointerEvents={iconsVisible ? "auto" : "none"}
        style={[styles.toolbarLeft, { top: insets.top + 8 }, toolbarStyle]}
      >
        <ToolbarButton icon="menu-outline" onPress={() => jumpToHomePage("menu")} />
      </Animated.View>
      <Animated.View
        pointerEvents={iconsVisible ? "auto" : "none"}
        style={[styles.fab, { bottom: insets.bottom + 36 }, fabStyle]}
      >
        <DictationButton onRecordingChange={setRecordingActive} />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { flex: 1, paddingHorizontal: 20 },
  input: {
    flex: 1,
    fontSize: 17,
    lineHeight: 26,
    paddingTop: 44,
  },
  // Full-width, bottom-anchored track that centers the tongue tab.
  tongueTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  // A rounded tab (semicircular cap) that stretches upward with the pull.
  tongue: {
    width: TONGUE_WIDTH,
    borderTopLeftRadius: TONGUE_WIDTH / 2,
    borderTopRightRadius: TONGUE_WIDTH / 2,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  // The two chevrons (rest + armed) stack at the tab's crest and cross-fade.
  chevron: {
    position: "absolute",
    top: 9,
    left: 0,
    right: 0,
    alignItems: "center",
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
