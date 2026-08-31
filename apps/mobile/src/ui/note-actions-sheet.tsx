// The actions on a note, reached by holding it in any list.
//
// A sheet rather than an inline row of icons (the dictation button's idiom):
// there are five labelled actions, some destructive, and reviewing a feed is a
// one-thumb job — the bottom of the screen is where the thumb already is.

import { Ionicons } from "@expo/vector-icons";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../theme";

export type NoteSheetAction =
  | "archive"
  | "unarchive"
  | "move"
  | "delete"
  | "select";

type ActionSpec = {
  action: NoteSheetAction;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
};

export const NoteActionsSheet = ({
  visible,
  title,
  archived,
  count,
  onAction,
  onClose,
}: {
  visible: boolean;
  title: string;
  /** Whether the note carries the archived marker. Ignored when count > 1. */
  archived: boolean;
  count: number;
  onAction: (action: NoteSheetAction) => void;
  onClose: () => void;
}) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const batch = count > 1;

  // Archiving is the front-matter marker, not a move into the Archieve
  // folder — the note stays where it is. "Move to folder…" covers the other.
  const actions: ActionSpec[] = [
    batch || !archived
      ? { action: "archive", label: "Archive", icon: "archive-outline" }
      : { action: "unarchive", label: "Unarchive", icon: "arrow-undo-outline" },
    { action: "move", label: "Move to folder…", icon: "folder-open-outline" },
    ...(batch
      ? []
      : ([
          {
            action: "select",
            label: "Select more…",
            icon: "checkmark-circle-outline",
          },
        ] as ActionSpec[])),
    { action: "delete", label: "Delete", icon: "trash-outline", destructive: true },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.border,
            paddingBottom: insets.bottom + 12,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.title, { color: theme.colors.secondaryText }]}
        >
          {batch ? `${count} notes` : title || "Empty note"}
        </Text>
        <ScrollView bounces={false}>
          {actions.map((spec) => (
            <Pressable
              key={spec.action}
              onPress={() => onAction(spec.action)}
              style={({ pressed }) => [
                styles.row,
                {
                  borderTopColor: theme.colors.border,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Ionicons
                name={spec.icon}
                size={20}
                color={spec.destructive ? theme.colors.danger : theme.colors.text}
              />
              <Text
                style={[
                  styles.rowLabel,
                  {
                    color: spec.destructive
                      ? theme.colors.danger
                      : theme.colors.text,
                  },
                ]}
              >
                {spec.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 14,
    maxHeight: "70%",
  },
  title: { fontSize: 13, paddingHorizontal: 20, paddingBottom: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: 17 },
});
