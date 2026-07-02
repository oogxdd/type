// The home screen and the app's signature interaction: a blank page you can
// type on immediately. Swiping up files the page away (the note slides off the
// top) and a fresh blank page is ready underneath — same gesture as the
// original app. Notes land in Feed via the desktop-compatible core.

import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
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
import { useTheme } from "../theme";

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
  };

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

  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const onChange = (value: string) => {
    setText(value);
    session.onChange(value);
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <GestureDetector gesture={pan}>
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
            placeholder="Start typing…"
            placeholderTextColor={theme.colors.secondaryText}
            multiline
            autoFocus
            scrollEnabled
            textAlignVertical="top"
            keyboardAppearance={theme.dark ? "dark" : "light"}
          />
          <Text
            style={[
              styles.hint,
              { color: theme.colors.secondaryText, marginBottom: insets.bottom + 8 },
            ]}
          >
            swipe up for a new page
          </Text>
        </Animated.View>
      </GestureDetector>

      <View style={[styles.toolbar, { top: insets.top + 8 }]}>
        <ToolbarButton label="Mic" onPress={() => navigation.navigate("Record")} />
        <ToolbarButton label="Feed" onPress={() => navigation.navigate("Feed")} />
      </View>
    </View>
  );
};

const ToolbarButton = ({ label, onPress }: { label: string; onPress: () => void }) => {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.toolbarButton,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <Text style={[styles.toolbarButtonText, { color: theme.colors.secondaryText }]}>
        {label}
      </Text>
    </Pressable>
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
  hint: { textAlign: "center", fontSize: 12, paddingVertical: 6 },
  toolbar: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    gap: 8,
  },
  toolbarButton: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  toolbarButtonText: { fontSize: 13, fontWeight: "500" },
});
