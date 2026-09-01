// Plain-text editor for an existing note. Reads the decrypted body from the
// core, autosaves with a debounce, and flushes on blur/unmount — the same
// contract as the desktop editor, minus rich text.

import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from "react-native-reanimated";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import { isRecordingNoteType } from "@typenotes/shared/format";
import type { NoteMeta } from "@typenotes/shared/types";

import type { RootStackParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { useSyncStore } from "../state/sync-store";
import { useTheme } from "../theme";
import { RecordingAudioPlayer } from "../ui/audio-player";

const SAVE_DEBOUNCE_MS = 400;

export const EditorScreen = () => {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, "Editor">>();
  const { path } = route.params;

  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<NoteMeta | null>(null);

  // Shrink the editor above the keyboard so the caret is never covered
  // (Apple Notes style) — the multiline input keeps the cursor in view within
  // its own bounds once those bounds sit above the keyboard.
  const keyboard = useAnimatedKeyboard();
  const rootStyle = useAnimatedStyle(() => ({
    paddingBottom: keyboard.height.value,
  }));

  const latest = useRef({ text: "", dirty: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    core
      .readNote(path)
      .then((body) => {
        if (!cancelled) {
          latest.current = { text: body, dirty: false };
          setText(body);
        }
      })
      .catch((err) => !cancelled && setError(getErrorMessage(err)));
    core
      .getNoteMeta(path)
      .then((noteMeta) => !cancelled && setMeta(noteMeta))
      .catch(() => {
        // Non-fatal — the note still opens for editing without the audio header.
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const flush = async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!latest.current.dirty) {
      return;
    }
    latest.current.dirty = false;
    try {
      await core.writeNote(path, latest.current.text);
      await useNotesStore.getState().refreshPreviews([path]);
      useSyncStore.getState().scheduleAutoSync("note saved");
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const onChange = (value: string) => {
    setText(value);
    latest.current = { text: value, dirty: true };
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  };

  // Flush on navigation away and on unmount. This must be "blur", not
  // "beforeRemove": merely adding a beforeRemove listener makes the native
  // stack disable the interactive back swipe for the screen (the native
  // transition can't be paused from JS, so react-navigation turns the
  // gesture off wholesale).
  useEffect(() => navigation.addListener("blur", () => void flush()), [navigation]);
  useEffect(
    () => () => {
      void flush();
    },
    []
  );

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <Text style={{ color: theme.colors.danger }}>{error}</Text>
      </View>
    );
  }

  const audioPath = meta?.recording_audio_path || null;
  const isRecording = isRecordingNoteType(meta?.note_type, audioPath);

  return (
    <Animated.View style={[styles.root, { backgroundColor: theme.colors.background }, rootStyle]}>
      {isRecording && audioPath ? <RecordingAudioPlayer audioPath={audioPath} /> : null}
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: theme.colors.background,
            color: theme.colors.text,
            fontSize: theme.fontSize,
            lineHeight: theme.lineHeight,
            fontFamily: theme.fontFamily,
          },
        ]}
        value={text ?? ""}
        editable={text !== null}
        onChangeText={onChange}
        multiline
        textAlignVertical="top"
        keyboardAppearance={theme.dark ? "dark" : "light"}
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  // fontSize/lineHeight come from the theme (Settings → Appearance).
  input: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
});
