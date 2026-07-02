import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text } from "react-native";

import { findFolder, folderNoteRows } from "../lib/feed";
import type { RootStackParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { useTheme } from "../theme";
import { NoteListRow } from "./feed-screen";

export const FolderScreen = () => {
  const theme = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "Folder">>();
  const tree = useNotesStore((s) => s.tree);
  const previews = useNotesStore((s) => s.previews);
  const loading = useNotesStore((s) => s.loading);
  const refresh = useNotesStore((s) => s.refresh);

  const folder = findFolder(tree, route.params.path);
  const rows = folderNoteRows(folder, previews);

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => void refresh()} />
      }
    >
      {folder?.children.map((child) => (
        <Pressable
          key={child.path}
          onPress={() =>
            navigation.push("Folder", { path: child.path, title: child.name })
          }
          style={({ pressed }) => [
            styles.folderRow,
            { borderBottomColor: theme.colors.border, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.folderName, { color: theme.colors.text }]}>
            {child.name}
          </Text>
          <Text style={[styles.folderMeta, { color: theme.colors.secondaryText }]}>
            {child.notes.length > 0 ? `${child.notes.length} notes` : ""} ›
          </Text>
        </Pressable>
      ))}
      {rows.map((row) => (
        <NoteListRow
          key={row.path}
          row={row}
          theme={theme}
          onPress={() =>
            navigation.navigate("Editor", {
              path: row.path,
              title: row.preview.title || "Note",
            })
          }
        />
      ))}
      {!folder || (folder.children.length === 0 && rows.length === 0) ? (
        <Text style={[styles.empty, { color: theme.colors.secondaryText }]}>
          Empty folder.
        </Text>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  folderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderName: { fontSize: 16, fontWeight: "600" },
  folderMeta: { fontSize: 13 },
  empty: { textAlign: "center", marginTop: 48, fontSize: 14 },
});
