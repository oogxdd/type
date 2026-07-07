// Custom drawer menu: Feed / Folders tabs on top (inline note + folder lists),
// Sync and Settings pinned at the bottom. Opened with the hamburger on the
// capture page or a swipe from the left edge.

import type { DrawerContentComponentProps } from "@react-navigation/drawer";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";

import { findFolder, folderNoteRows } from "../lib/feed";
import type { RootStackParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { useTheme } from "../theme";
import { NoteListRow } from "../screens/feed-screen";

type DrawerTab = "feed" | "folders";

export const AppDrawerContent = ({ navigation }: DrawerContentComponentProps) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<DrawerTab>("feed");

  const tree = useNotesStore((s) => s.tree);
  const previews = useNotesStore((s) => s.previews);

  const openScreen = <Screen extends keyof RootStackParamList>(
    screen: Screen,
    params?: RootStackParamList[Screen]
  ) => {
    navigation.navigate("Home", { screen, params } as never);
    navigation.closeDrawer();
  };

  const feedRows = folderNoteRows(findFolder(tree, FEED_FOLDER_PATH), previews);
  const folders = findFolder(tree, "")?.children ?? [];

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.colors.background,
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 8,
        },
      ]}
    >
      <View style={[styles.tabs, { backgroundColor: theme.colors.surface }]}>
        <TabButton label="Feed" active={tab === "feed"} onPress={() => setTab("feed")} />
        <TabButton
          label="Folders"
          active={tab === "folders"}
          onPress={() => setTab("folders")}
        />
      </View>

      {tab === "feed" ? (
        <FlatList
          style={styles.list}
          data={feedRows}
          keyExtractor={(row) => row.path}
          renderItem={({ item }) => (
            <NoteListRow
              row={item}
              theme={theme}
              onPress={() =>
                openScreen("Editor", {
                  path: item.path,
                  title: item.preview.title || "Note",
                })
              }
            />
          )}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: theme.colors.secondaryText }]}>
              No notes yet — close the menu and start typing.
            </Text>
          }
        />
      ) : (
        <FlatList
          style={styles.list}
          data={folders}
          keyExtractor={(folder) => folder.path}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openScreen("Folder", { path: item.path, title: item.name })}
              style={({ pressed }) => [
                styles.folderRow,
                { borderBottomColor: theme.colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.folderName, { color: theme.colors.text }]}>
                {item.name}
              </Text>
              <Text style={[styles.folderMeta, { color: theme.colors.secondaryText }]}>
                {item.notes.length > 0 ? `${item.notes.length}` : ""} ›
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: theme.colors.secondaryText }]}>
              No folders yet.
            </Text>
          }
        />
      )}

      <View style={[styles.bottom, { borderTopColor: theme.colors.border }]}>
        <BottomItem label="Sync" onPress={() => openScreen("Sync")} />
        <BottomItem label="Settings" onPress={() => openScreen("Settings")} />
      </View>
    </View>
  );
};

const TabButton = ({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) => {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        {
          backgroundColor: active ? theme.colors.background : "transparent",
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.tabLabel,
          { color: active ? theme.colors.text : theme.colors.secondaryText },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
};

const BottomItem = ({ label, onPress }: { label: string; onPress: () => void }) => {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.bottomItem, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.bottomLabel, { color: theme.colors.text }]}>{label}</Text>
      <Text style={{ color: theme.colors.secondaryText }}>›</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabs: {
    flexDirection: "row",
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  tab: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  tabLabel: { fontSize: 14, fontWeight: "600" },
  list: { flex: 1 },
  empty: { textAlign: "center", marginTop: 32, fontSize: 13, paddingHorizontal: 16 },
  folderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderName: { fontSize: 15, fontWeight: "600" },
  folderMeta: { fontSize: 13 },
  bottom: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
  },
  bottomItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  bottomLabel: { fontSize: 15, fontWeight: "500" },
});
