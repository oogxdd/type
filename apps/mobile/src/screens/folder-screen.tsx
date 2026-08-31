// One folder: its subfolders, then its notes in the order the core returned
// them (that is the folder's .notes-order.json — what was arranged by dragging
// on the desktop). Notes can be held for the same actions as in the feed.

import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { browsableFolders, findFolder, folderNoteCount, folderNoteRows } from "../lib/feed";
import type { NoteRow } from "../lib/feed";
import type { RootStackParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { useTheme } from "../theme";
import { useNoteOrganizer } from "../ui/note-organizer";
import { NoteListRow } from "./feed-screen";

import type { FolderNode } from "@typenotes/shared/types";

type Item =
  | { kind: "folder"; key: string; folder: FolderNode }
  | { kind: "note"; key: string; row: NoteRow };

export const FolderScreen = () => {
  const theme = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "Folder">>();
  const tree = useNotesStore((s) => s.tree);
  const previews = useNotesStore((s) => s.previews);
  const loading = useNotesStore((s) => s.loading);
  const refresh = useNotesStore((s) => s.refresh);
  const organizer = useNoteOrganizer(tree);

  const folder = findFolder(tree, route.params.path);
  const subfolders = browsableFolders(folder);
  const rows = folderNoteRows(folder, previews);

  // One virtualized list rather than a ScrollView of everything: a folder can
  // hold hundreds of notes.
  const items: Item[] = [
    ...subfolders.map((child) => ({
      kind: "folder" as const,
      key: `folder:${child.path}`,
      folder: child,
    })),
    ...rows.map((row) => ({ kind: "note" as const, key: row.path, row })),
  ];

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => void refresh()} />
        }
        renderItem={({ item }) =>
          item.kind === "folder" ? (
            <Pressable
              onPress={() =>
                navigation.push("Folder", {
                  path: item.folder.path,
                  title: item.folder.name,
                })
              }
              style={({ pressed }) => [
                styles.folderRow,
                {
                  borderBottomColor: theme.colors.border,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <View style={styles.folderLabel}>
                <Ionicons
                  name="folder-outline"
                  size={17}
                  color={theme.colors.secondaryText}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.folderName, { color: theme.colors.text }]}
                >
                  {item.folder.name}
                </Text>
              </View>
              <Text
                style={[styles.folderMeta, { color: theme.colors.secondaryText }]}
              >
                {/* Notes below this folder too, not just its direct children. */}
                {folderNoteCount(item.folder) || ""} ›
              </Text>
            </Pressable>
          ) : (
            <NoteListRow
              row={item.row}
              theme={theme}
              selecting={organizer.selecting}
              selected={organizer.isSelected(item.row.path)}
              onLongPress={() => organizer.onRowLongPress(item.row)}
              onPress={() => {
                if (organizer.onRowPress(item.row)) {
                  return;
                }
                navigation.navigate("Editor", {
                  path: item.row.path,
                  title: item.row.preview.title || "Note",
                });
              }}
            />
          )
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.colors.secondaryText }]}>
            Empty folder.
          </Text>
        }
      />
      {organizer.overlay}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  folderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 1,
  },
  folderName: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
  folderMeta: { fontSize: 13 },
  empty: { textAlign: "center", marginTop: 48, fontSize: 14 },
});
