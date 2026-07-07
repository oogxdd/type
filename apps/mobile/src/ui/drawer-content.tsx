// Custom drawer menu: Feed / Folders tabs on top (inline note + folder lists),
// Sync and Settings pinned at the bottom. Opened with the hamburger on the
// capture page or a swipe from the left edge.

import { Ionicons } from "@expo/vector-icons";
import { useDrawerStatus, type DrawerContentComponentProps } from "@react-navigation/drawer";
import { useEffect, useState } from "react";
import { FlatList, Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";

import { findFolder, folderNoteRows, groupNoteRowsByDate } from "../lib/feed";
import { formatRelativeTime } from "../lib/relative-time";
import type { RootStackParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { useSyncStore } from "../state/sync-store";
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

  // Whatever screen was behind the drawer, reset the stack under it to
  // Capture the moment it opens — so dismissing the drawer any way (swipe
  // closed, tap outside, Android back) always lands on the home screen,
  // not wherever you happened to open the drawer from. Picking an item in
  // the drawer still navigates forward from here as normal.
  const drawerStatus = useDrawerStatus();
  useEffect(() => {
    if (drawerStatus === "open") {
      navigation.navigate("Home", { screen: "Capture" } as never);
    }
  }, [drawerStatus, navigation]);

  const feedRows = folderNoteRows(findFolder(tree, FEED_FOLDER_PATH), previews);
  const feedSections = groupNoteRowsByDate(feedRows);
  const folders = findFolder(tree, "")?.children ?? [];

  const lastSyncedMs = useSyncStore((s) => s.history[0]?.authored_ms ?? null);

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
      <Pressable
        onPress={() => openScreen("Capture")}
        style={({ pressed }) => [
          styles.newNote,
          { borderColor: theme.colors.border, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Ionicons name="add-circle-outline" size={20} color={theme.colors.accent} />
        <Text style={[styles.newNoteLabel, { color: theme.colors.accent }]}>New note</Text>
      </Pressable>

      <View style={[styles.tabs, { backgroundColor: theme.colors.surface }]}>
        <TabButton label="Feed" active={tab === "feed"} onPress={() => setTab("feed")} />
        <TabButton
          label="Folders"
          active={tab === "folders"}
          onPress={() => setTab("folders")}
        />
      </View>

      {tab === "feed" ? (
        <SectionList
          style={styles.list}
          sections={feedSections}
          keyExtractor={(row) => row.path}
          stickySectionHeadersEnabled
          renderSectionHeader={({ section }) => (
            <View style={[styles.sectionHeader, { backgroundColor: theme.colors.background }]}>
              <Text style={[styles.sectionHeaderText, { color: theme.colors.secondaryText }]}>
                {section.title}
              </Text>
            </View>
          )}
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
        <BottomItem
          label="Sync"
          subtitle={`Last synced ${formatRelativeTime(lastSyncedMs)}`}
          onPress={() => openScreen("Sync")}
        />
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

const BottomItem = ({
  label,
  subtitle,
  onPress,
}: {
  label: string;
  subtitle?: string;
  onPress: () => void;
}) => {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.bottomItem, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={styles.bottomItemText}>
        <Text style={[styles.bottomLabel, { color: theme.colors.text }]}>{label}</Text>
        {subtitle ? (
          <Text style={[styles.bottomSubtitle, { color: theme.colors.secondaryText }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: theme.colors.secondaryText }}>›</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  newNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  newNoteLabel: { fontSize: 15, fontWeight: "600" },
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
  sectionHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  sectionHeaderText: { fontSize: 12, fontWeight: "700" },
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
  bottomItemText: { gap: 2 },
  bottomLabel: { fontSize: 15, fontWeight: "500" },
  bottomSubtitle: { fontSize: 12 },
});
