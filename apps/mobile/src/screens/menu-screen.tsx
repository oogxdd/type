// The app menu — the left page of the Home pager: close button + Feed /
// Folders tabs on top (inline note + folder lists), Sync and Settings pinned
// at the bottom. Swiping left (or the close button) pages back to capture;
// Feed/Folder/Editor/Settings are pushed onto the stack above the pager, so
// swipe-back from them lands back here. The pager owns the horizontal
// gesture natively, so taps and list scrolling need no special guards.

import { Ionicons } from "@expo/vector-icons";
import { CommonActions, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import {
  FlatList,
  InteractionManager,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";

import {
  browsableFolders,
  findFolder,
  folderNoteRows,
  groupNoteRowsByDate,
} from "../lib/feed";
import { formatRelativeTime } from "../lib/relative-time";
import { jumpToHomePage, type RootStackParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { useSyncStore } from "../state/sync-store";
import { useTheme } from "../theme";
import { ToolbarButton } from "../ui/toolbar-button";
import { NoteListRow } from "./feed-screen";

type MenuTab = "feed" | "folders";

export const MenuScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [tab, setTab] = useState<MenuTab>("feed");

  const tree = useNotesStore((s) => s.tree);
  const previews = useNotesStore((s) => s.previews);

  const openScreen = <Screen extends keyof RootStackParamList>(
    screen: Screen,
    params?: RootStackParamList[Screen]
  ) => {
    navigation.dispatch(CommonActions.navigate({ name: screen, params }));
  };

  const lastSyncedMs = useSyncStore((s) => s.history[0]?.authored_ms ?? null);

  // All three pager pages mount in the app's first React commit, so building
  // the note/folder lists here would sit on the first-paint path. Render an
  // empty page for the first tick and fill in right after — done long before
  // a swipe can reveal the menu.
  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setContentReady(true));
    return () => task.cancel();
  }, []);
  if (!contentReady) {
    return <View style={[styles.root, { backgroundColor: theme.colors.background }]} />;
  }

  const feedRows = folderNoteRows(findFolder(tree, FEED_FOLDER_PATH), previews);
  const feedSections = groupNoteRowsByDate(feedRows);
  const folders = browsableFolders(findFolder(tree, ""));

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
      <View style={styles.topBar}>
        <ToolbarButton icon="close-outline" onPress={() => jumpToHomePage("capture")} />
      </View>

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
              No notes yet — swipe left and start typing.
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

      {/* App-level destinations, visually set apart from the note/folder
          rows by the grouped card (same surface treatment as the tabs). */}
      <View style={[styles.bottom, { backgroundColor: theme.colors.surface }]}>
        <BottomItem
          icon="sync-outline"
          label="Sync"
          subtitle={`Last synced ${formatRelativeTime(lastSyncedMs)}`}
          onPress={() => jumpToHomePage("sync")}
        />
        <View style={[styles.bottomSeparator, { backgroundColor: theme.colors.border }]} />
        <BottomItem
          icon="settings-outline"
          label="Settings"
          onPress={() => openScreen("Settings")}
        />
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
  icon,
  label,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
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
      <Ionicons name={icon} size={18} color={theme.colors.secondaryText} />
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
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
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
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 12,
    overflow: "hidden",
  },
  bottomSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 46,
  },
  bottomItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    // Keeps the one-line Settings row as tall as the two-line Sync row.
    minHeight: 60,
  },
  bottomItemText: { flex: 1, gap: 2 },
  bottomLabel: { fontSize: 15, fontWeight: "500" },
  bottomSubtitle: { fontSize: 12 },
});
