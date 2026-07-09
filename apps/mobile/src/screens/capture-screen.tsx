// The home screen and the app's signature interaction: a blank page you can
// type on immediately. Swiping up files the page away (the note slides off the
// top) and a fresh blank page is ready underneath — same gesture as the
// original app. Notes land in Feed via the desktop-compatible core.

import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
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
  useAnimatedStyle,
  useSharedValue,
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

const SWIPE_DISTANCE = 90;
const SWIPE_VELOCITY = -900;

// The finger-driven swipe to the sync screen (same mechanics as the menu's
// swipe-to-capture in menu-screen.tsx): release past this fraction of the
// screen (or a faster leftward flick) commits, the page parallaxes left
// behind the incoming preview.
const SYNC_OPEN_PROGRESS = 0.3;
const SYNC_OPEN_VELOCITY = -500;
const SYNC_PARALLAX = 0.3;

export const CaptureScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { height, width } = useWindowDimensions();

  const [text, setText] = useState("");
  const [pageKey, setPageKey] = useState(0);
  const [iconsVisible, setIconsVisible] = useState(true);
  const [recordingActive, setRecordingActive] = useState(false);
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

  // The menu's swipe may have pushed this page with animation:none (its
  // preview already played the transition) — flip the flag back once the
  // push settles so the later pop / back swipe animates natively.
  useClearInstantParam();

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

  // Conceptually the sync screen sits to the RIGHT of the capture page (the
  // menu is to the left): a clearly-leftward drag pulls it in with the
  // finger, exactly like the menu's swipe-to-capture — a preview overlay
  // (background + a replica of Sync's native header) rides the finger, and
  // committing pushes the real screen underneath it with animation:none.
  // Rightward drags stay with the native back swipe, vertical ones with the
  // page gestures. Sync's body is dynamic so the preview can't replicate it;
  // only the chrome matches and the content appears at the swap.
  const syncProgress = useSharedValue(0);

  const syncDepthStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -width * SYNC_PARALLAX * syncProgress.value }],
  }));
  const syncDimStyle = useAnimatedStyle(() => ({
    opacity: 0.08 * syncProgress.value,
  }));
  const syncPreviewStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: width * (1 - syncProgress.value) }],
    // Parked exactly one screen-width right; hide it whenever this gesture
    // isn't driving it or native pops (which parallax this whole screen)
    // would poke its edge into the frame — same trap as the menu's preview.
    opacity: syncProgress.value > 0 ? 1 : 0,
  }));

  const openSyncBehindPreview = () => {
    navigation.navigate("Sync", { instant: true });
    // Drop the preview once the pushed screen is attached on top (no native
    // "attached" signal with animation:none — the delay outlives the mount).
    setTimeout(() => {
      syncProgress.value = 0;
    }, 400);
  };

  const swipeToSync = Gesture.Pan()
    .activeOffsetX(-24)
    .failOffsetX(24)
    .failOffsetY([-24, 24])
    .onStart(() => {
      // The capture input stays mounted (and focused) beneath the pushed
      // screen and would otherwise keep the keyboard up over it.
      runOnJS(dismissKeyboard)();
    })
    .onUpdate((event) => {
      syncProgress.value = Math.min(1, Math.max(0, -event.translationX / width));
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

  const pan = Gesture.Pan()
    // Only claim clearly-upward drags; leave taps and downward scrolling to
    // the text input, and mostly-horizontal drags to the navigator's
    // full-screen back swipe (Capture screen options in App.tsx). The ±48
    // fail zone is deliberately wider than the -24 activation so a fast
    // diagonal swipe-up still files the page.
    .activeOffsetY([-24, Number.MAX_SAFE_INTEGER])
    .failOffsetX([-48, 48])
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
      <Animated.View style={[styles.depth, syncDepthStyle]}>
      <GestureDetector gesture={Gesture.Race(pan, dismissKeyboardPan, swipeToSync)}>
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

      <Animated.View
        pointerEvents={iconsVisible ? "auto" : "none"}
        style={[styles.toolbarLeft, { top: insets.top + 8 }, toolbarStyle]}
      >
        <ToolbarButton
          icon="menu-outline"
          // popTo, not navigate: the menu is the stack root below this
          // screen, and v7 navigate would push a second Menu on top (sliding
          // in from the right) instead of popping back to it.
          onPress={() => navigation.popTo("Menu")}
        />
      </Animated.View>
      <Animated.View
        pointerEvents={iconsVisible ? "auto" : "none"}
        style={[styles.fab, { bottom: insets.bottom + 36 }, toolbarStyle]}
      >
        <DictationButton onRecordingChange={setRecordingActive} />
      </Animated.View>
      </Animated.View>

      {/* Native-push depth cues for the sync swipe: the page dims while the
          sync preview rides in above it (see swipeToSync). */}
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
        {/* Replica of Sync's native header (title + chevron-only back) so
            the instant swap after commit only pops the body in. */}
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
  // Mirrors the native-stack header: 44pt bar, centered 17pt semibold title,
  // chevron-only back at the left edge.
  syncPreviewBar: { height: 44, alignItems: "center", justifyContent: "center" },
  syncPreviewBack: { position: "absolute", left: 8, top: 9 },
  syncPreviewTitle: { fontSize: 17, fontWeight: "600" },
  page: { flex: 1, paddingHorizontal: 20 },
  input: {
    flex: 1,
    fontSize: 17,
    lineHeight: 26,
    paddingTop: 44,
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
