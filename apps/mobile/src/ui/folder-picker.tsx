// Choosing where notes go — and, incidentally, the only way to create a folder.
//
// Neither type-core nor the desktop has a create-folder command: `move_items`
// and `create_note` both `create_dir_all` their destination, which is why the
// desktop's own move dialog says "Missing folders will be created". So this
// picker is a list of existing folders *and* a path field, and typing a path
// that does not exist yet is how a folder comes into being.

import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ARCHIEVE_FOLDER_PATH,
  FEED_FOLDER_PATH,
} from "@typenotes/shared/constants";
import type { FolderNode } from "@typenotes/shared/types";

import { allFolderPaths } from "../lib/folder-tree";
import { useTheme } from "../theme";
import { Button } from "./controls";

/** Trim and collapse a typed path so "  Work / Q3 / " reads as "Work/Q3". */
export const normalizeFolderPath = (value: string): string =>
  value
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("/");

export const FolderPickerModal = ({
  visible,
  tree,
  heading,
  onPick,
  onClose,
}: {
  visible: boolean;
  tree: FolderNode | null;
  heading: string;
  onPick: (destination: string) => void;
  onClose: () => void;
}) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [typed, setTyped] = useState("");

  const existing = useMemo(() => allFolderPaths(tree), [tree]);
  const pinned = [FEED_FOLDER_PATH, ARCHIEVE_FOLDER_PATH].filter((path) =>
    existing.includes(path)
  );
  const browsable = existing.filter((path) => !pinned.includes(path));

  const typedPath = normalizeFolderPath(typed);
  const typedIsNew = typedPath.length > 0 && !existing.includes(typedPath);

  const choose = (destination: string) => {
    setTyped("");
    onPick(destination);
  };

  const close = () => {
    setTyped("");
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={close}
      presentationStyle="pageSheet"
    >
      <View
        style={[
          styles.root,
          {
            backgroundColor: theme.colors.background,
            paddingTop: insets.top + 12,
          },
        ]}
      >
        <View style={styles.header}>
          <Text style={[styles.heading, { color: theme.colors.text }]}>
            {heading}
          </Text>
          <Button title="Cancel" kind="secondary" onPress={close} />
        </View>

        <View style={styles.newFolder}>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="New folder path, e.g. Work/Q3"
            placeholderTextColor={theme.colors.secondaryText}
            autoCapitalize="words"
            autoCorrect={false}
            style={[
              styles.input,
              {
                color: theme.colors.text,
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          />
          {typedPath ? (
            <Pressable
              onPress={() => choose(typedPath)}
              style={({ pressed }) => [
                styles.createRow,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons
                name={typedIsNew ? "add-circle-outline" : "folder-outline"}
                size={20}
                color={theme.colors.accent}
              />
              <Text style={[styles.createLabel, { color: theme.colors.accent }]}>
                {typedIsNew
                  ? `Create “${typedPath}” and move here`
                  : `Move to “${typedPath}”`}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView style={styles.list}>
          {pinned.map((path) => (
            <FolderRow
              key={path}
              path={path}
              depth={0}
              onPress={() => choose(path)}
            />
          ))}
          {browsable.map((path) => (
            <FolderRow
              key={path}
              path={path}
              depth={path.split("/").length - 1}
              onPress={() => choose(path)}
            />
          ))}
          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>
      </View>
    </Modal>
  );
};

const FolderRow = ({
  path,
  depth,
  onPress,
}: {
  path: string;
  depth: number;
  onPress: () => void;
}) => {
  const theme = useTheme();
  const name = path.split("/").pop() ?? path;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.folderRow,
        {
          borderBottomColor: theme.colors.border,
          paddingLeft: 20 + depth * 18,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <Ionicons
        name="folder-outline"
        size={18}
        color={theme.colors.secondaryText}
      />
      <Text style={[styles.folderName, { color: theme.colors.text }]}>
        {name}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  heading: { fontSize: 20, fontWeight: "600", flexShrink: 1 },
  newFolder: { paddingHorizontal: 20, paddingBottom: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
  },
  createLabel: { fontSize: 16, flexShrink: 1 },
  list: { flex: 1 },
  folderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingRight: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderName: { fontSize: 17 },
});
