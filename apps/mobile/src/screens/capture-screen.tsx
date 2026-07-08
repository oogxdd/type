// The home screen and the app's signature interaction: a blank page you can
// type on immediately. Swiping up files the page away (the note slides off the
// top) and a fresh blank page is ready underneath — same gesture as the
// original app. Notes land in Feed via the desktop-compatible core.

import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as core from "@typenotes/mobile-core/core-api";

import { CaptureSession } from "../lib/capture";
import type { RootStackParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { useUiPrefsStore } from "../state/ui-prefs-store";
import { useTheme } from "../theme";
import { DictationButton } from "../ui/dictation-button";
import { ToolbarButton } from "../ui/toolbar-button";

const SWIPE_DISTANCE = 90;
const SWIPE_VELOCITY = -900;

export const CaptureScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { height } = useWindowDimensions();

  const [text, setText] = useState("");
  const [pageKey, setPageKey] = useState(0);
  const [iconsVisible, setIconsVisible] = useState(true);
  const [recordingActive, setRecordingActive] = useState(false);
  const menuSide = useUiPrefsStore((s) => s.menuSide);
  const iconsOpacity = useSharedValue(1);
  const inputRef = useRef<TextInput>(null);

  const session = useMemo(
    () =>
      new CaptureSession({
        createNote: async (content) => (await core.createNote({ content })).path,
        writeNote: core.writeNote,
        deleteNote: (path) => core.deleteItems([path]),
      }),
    []
  );

  // Flush the draft when the screen loses focus (navigation away).
  useEffect(
    () => navigation.addListener("blur", () => void session.flush()),
    [navigation, session]
  );

  const translateY = useSharedValue(0);

  // Wrap Keyboard.dismiss so the worklet captures this plain closure rather
  // than the bare method — passing Keyboard.dismiss straight to runOnJS makes
  // worklets try to copy its owner (KeyboardImpl), which it can't serialize.
  const dismissKeyboard = () => Keyboard.dismiss();

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

  // A clear downward drag tucks the keyboard away (the input regains it on
  // the next tap). Runs alongside the swipe-up gesture, which claims only
  // upward drags.
  const dismissKeyboardPan = Gesture.Pan()
    .activeOffsetY(24)
    .failOffsetY(-12)
    .onStart(() => {
      runOnJS(dismissKeyboard)();
    });

  const pan = Gesture.Pan()
    // Only claim clearly-upward drags; leave taps, horizontal moves, and
    // downward scrolling to the text input.
    .activeOffsetY([-24, Number.MAX_SAFE_INTEGER])
    .failOffsetY(12)
    .onUpdate((event) => {
      translateY.value = Math.min(0, event.translationY);
    })
    .onEnd((event) => {
      const shouldCommit =
        event.translationY < -SWIPE_DISTANCE || event.velocityY < SWIPE_VELOCITY;
      if (shouldCommit) {
        translateY.value = withTiming(
          -height,
          { duration: 200 },
          (finished) => {
            if (finished) {
              runOnJS(commitPage)();
            }
          }
        );
      } else {
        translateY.value = withSpring(0, { damping: 20, stiffness: 300 });
      }
    });

  // Opening the menu is a push, so there's no native gesture for it — this
  // narrow strip over the screen edge claims the swipe before the text
  // input can. It sits over the page's horizontal padding, so it barely
  // covers any tappable text.
  const openMenu = () => navigation.navigate("Menu");
  const menuEdgePan = Gesture.Pan()
    .activeOffsetX(menuSide === "right" ? -20 : 20)
    .failOffsetX(menuSide === "right" ? 20 : -20)
    .failOffsetY([-24, 24])
    .onStart(() => {
      runOnJS(openMenu)();
    });

  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const toolbarStyle = useAnimatedStyle(() => ({
    opacity: iconsOpacity.value,
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
      <GestureDetector gesture={Gesture.Race(pan, dismissKeyboardPan)}>
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

      <GestureDetector gesture={menuEdgePan}>
        <View
          style={[
            styles.menuEdge,
            menuSide === "right" ? styles.menuEdgeRight : styles.menuEdgeLeft,
          ]}
        />
      </GestureDetector>

      <Animated.View
        pointerEvents={iconsVisible ? "auto" : "none"}
        style={[
          styles.toolbarTop,
          menuSide === "right" ? styles.toolbarTopRight : styles.toolbarTopLeft,
          { top: insets.top + 8 },
          toolbarStyle,
        ]}
      >
        <ToolbarButton icon="menu-outline" onPress={openMenu} />
      </Animated.View>
      <Animated.View
        pointerEvents={iconsVisible ? "auto" : "none"}
        style={[styles.fab, { bottom: insets.bottom + 24 }, toolbarStyle]}
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
  fab: {
    position: "absolute",
    right: 20,
    alignItems: "flex-end",
  },
  toolbarTop: {
    position: "absolute",
    flexDirection: "row",
  },
  toolbarTopLeft: { left: 16 },
  toolbarTopRight: { right: 16 },
  menuEdge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 24,
  },
  menuEdgeLeft: { left: 0 },
  menuEdgeRight: { right: 0 },
});
