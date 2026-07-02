// Plain-text editor for an existing note. Reads the decrypted body from the
// core, autosaves with a debounce, and flushes on blur/unmount — the same
// contract as the desktop editor, minus rich text.

import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";

import type { RootStackParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { useTheme } from "../theme";

const SAVE_DEBOUNCE_MS = 400;

export const EditorScreen = () => {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, "Editor">>();
  const { path } = route.params;

  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latest = useRef({ text: "", dirty: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    core
      .readNote(path)
      .then((body) => {
        if (!cancelled) {
          latest.current = { text: body, dirty: false };
          setText(body);
        }
      })
      .catch((err) => !cancelled && setError(getErrorMessage(err)));
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

  // Flush on navigation away and on unmount.
  useEffect(() => navigation.addListener("beforeRemove", () => void flush()), [navigation]);
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

  return (
    <TextInput
      style={[
        styles.input,
        { backgroundColor: theme.colors.background, color: theme.colors.text },
      ]}
      value={text ?? ""}
      editable={text !== null}
      onChangeText={onChange}
      multiline
      textAlignVertical="top"
      keyboardAppearance={theme.dark ? "dark" : "light"}
    />
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  input: {
    flex: 1,
    fontSize: 17,
    lineHeight: 26,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
});
