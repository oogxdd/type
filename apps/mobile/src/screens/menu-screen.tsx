// The app menu lives inside the root full-width drawer. The capture page stays
// mounted underneath, and opening/closing is driven by the drawer's interactive
// edge gesture rather than a custom JS pan that triggers stack navigation.

import {
  DrawerActions,
  useNavigation,
  type NavigatorScreenParams,
} from "@react-navigation/native";
import type { DrawerNavigationProp } from "@react-navigation/drawer";
import { useState } from "react";
import { FlatList, Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";

import {
  browsableFolders,
  findFolder,
  folderNoteRows,
  groupNoteRowsByDate,
} from "../lib/feed";
import { formatRelativeTime } from "../lib/relative-time";
import type { MainStackParamList, RootDrawerParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { useSyncStore } from "../state/sync-store";
import { useUiPrefsStore } from "../state/ui-prefs-store";
import { useTheme } from "../theme";
import { ToolbarButton } from "../ui/toolbar-button";
import { NoteListRow } from "./feed-screen";

type MenuTab = "feed" | "folders";

export const MenuScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<DrawerNavigationProp<RootDrawerParamList>>();
  const [tab, setTab] = useState<MenuTab>("feed");

  const tree = useNotesStore((s) => s.tree);
  const previews = useNotesStore((s) => s.previews);

  const openScreen = <Screen extends keyof MainStackParamList>(
    screen: Screen,
    params?: MainStackParamList[Screen]
  ) => {
    navigation.navigate("Main", {
      screen,
      params,
    } as NavigatorScreenParams<MainStackParamList>);
    navigation.dispatch(DrawerActions.closeDrawer());
  };

  const menuSide = useUiPrefsStore((s) => s.menuSide);
  const closeMenu = () => navigation.dispatch(DrawerActions.closeDrawer());

  const lastSyncedMs = useSyncStore((s) => s.history[0]?.authored_ms ?? null);

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
      {/* Mirrors the capture page's hamburger: same spot, same size. */}
      <View
        style={[styles.topBar, menuSide === "right" ? styles.topBarRight : null]}
      >
        <ToolbarButton icon="close-outline" onPress={closeMenu} />
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
  topBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  topBarRight: { justifyContent: "flex-end" },
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
