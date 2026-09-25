// Persistent menu layer. HomeScreen owns all directional gestures.

import { Ionicons } from "@expo/vector-icons";
import { CommonActions, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  InteractionManager,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedProps } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ARCHIVE_FOLDER_PATH,
  STREAM_FOLDER_PATH,
} from "@typenotes/shared/constants";
import { matchesFeedFilter, type FeedNoteFilter } from "@typenotes/shared/note-filter";

import {
  feedNoteRows,
  findFolder,
  folderNoteCount,
  groupNoteRowsByDate,
  type NoteRow,
  type NoteRowSection,
} from "../lib/feed";
import {
  flattenFolderTree,
  toggleExpanded,
  type FolderTreeRow,
} from "../lib/folder-tree";
import { flushCaptureDraft } from "../lib/capture-draft";
import { formatRelativeTime } from "../lib/relative-time";
import { autoSyncLabel } from "../lib/sync-experience";
import type { RootStackParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { useSyncStore } from "../state/sync-store";
import { useTheme } from "../theme";
import { useNoteOrganizer } from "../ui/note-organizer";
import { ToolbarButton } from "../ui/toolbar-button";
import { NoteListRow } from "./feed-screen";
import { useHomeShell } from "./home-shell";

const AnimatedSectionList = Animated.createAnimatedComponent(SectionList<NoteRow, NoteRowSection>);

type MenuTab = "feed" | "folders";

// The subset of the desktop's filter chips that matches what the phone can
// set: archiving is the one marker the note sheet writes.
const FEED_FILTERS: Array<{ id: FeedNoteFilter; label: string }> = [
  { id: "active", label: "Active" },
  { id: "all", label: "All" },
  { id: "archived", label: "Archived" },
];

export const MenuScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { openCapture, suppressPressUntil, direction, dragging, feedScroll, folderScroll } = useHomeShell();
  const scrollProps = useAnimatedProps(() => ({
    scrollEnabled: !(dragging.value && (direction.value === "left" || direction.value === "right")),
  }));
  const [tab, setTab] = useState<MenuTab>("feed");
  // "Active" first: reviewing a feed means looking at what is not filed yet.
  const [filter, setFilter] = useState<FeedNoteFilter>("active");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const tree = useNotesStore((s) => s.tree);
  const previews = useNotesStore((s) => s.previews);
  const loading = useNotesStore((s) => s.loading);
  const refresh = useNotesStore((s) => s.refresh);

  // Selection, the note action sheet and the folder picker. Called here, above
  // the contentReady early return, because it is a hook.
  const organizer = useNoteOrganizer(tree);

  // The pan and native lists run simultaneously; do not treat a swipe as a tap.
  const pressWasSwipe = () => Date.now() < suppressPressUntil.value;

  const openScreen = <Screen extends keyof RootStackParamList>(
    screen: Screen,
    params?: RootStackParamList[Screen]
  ) => {
    if (pressWasSwipe()) {
      return;
    }
    void flushCaptureDraft().then(() => {
      navigation.dispatch(CommonActions.navigate({ name: screen, params }));
    }).catch(() => Alert.alert("Could not save draft", "Return to your note and try again."));
  };

  const selectTab = (next: MenuTab) => {
    if (!pressWasSwipe()) {
      setTab(next);
    }
  };

  const lastSyncedMs = useSyncStore((s) => s.history[0]?.authored_ms ?? null);
  const autoSyncState = useSyncStore((s) => s.autoSyncState);
  const syncAction = useSyncStore((s) => s.action);
  const syncNow = useSyncStore((s) => s.syncNow);
  const syncBusy = syncAction !== "idle";
  const syncSubtitle =
    autoSyncLabel(autoSyncState) ?? `Last synced ${formatRelativeTime(lastSyncedMs)}`;

  const quickSync = () => {
    if (pressWasSwipe() || syncBusy) {
      return;
    }
    void syncNow().catch(() => {
      // The store owns the visible error/waiting state; stay on the menu.
    });
  };

  // Defer menu lists until after the initial blank page is visible.
  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setContentReady(true));
    return () => task.cancel();
  }, []);

  // Building the rows sorts and date-groups every Feed note. This screen stays
  // mounted behind the capture page and re-renders on every sync-state change,
  // so rebuild only when the notes or the list controls actually change.
  const feedSections = useMemo(
    () =>
      contentReady
        ? groupNoteRowsByDate(
            feedNoteRows(findFolder(tree, STREAM_FOLDER_PATH), previews, {
              keep: (preview) => matchesFeedFilter(preview, filter),
            })
          )
        : [],
    [contentReady, tree, previews, filter]
  );
  const folderRows = useMemo(
    () => (contentReady ? flattenFolderTree(tree, expanded) : []),
    [contentReady, tree, expanded]
  );

  if (!contentReady) {
    return <View style={[styles.root, { backgroundColor: theme.colors.background }]} />;
  }

  const archive = findFolder(tree, ARCHIVE_FOLDER_PATH);

  // Pull down on either tab to re-read the tree + previews. Only one list is
  // mounted at a time, so sharing the control element is safe.
  const refreshControl = (
    <RefreshControl
      refreshing={loading}
      onRefresh={() => void refresh()}
      tintColor={theme.colors.secondaryText}
    />
  );

  return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <View
          style={[
            styles.menuContent,
            { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 },
          ]}
        >
        <View style={styles.topBar}>
          <ToolbarButton icon="close-outline" onPress={() => { if (!pressWasSwipe()) openCapture(); }} />
        </View>

        <View style={[styles.tabs, { backgroundColor: theme.colors.surface }]}>
          <TabButton label="Feed" active={tab === "feed"} onPress={() => selectTab("feed")} />
          <TabButton
            label="Folders"
            active={tab === "folders"}
            onPress={() => selectTab("folders")}
          />
        </View>

        {tab === "feed" ? (
          <View style={styles.filters}>
            {FEED_FILTERS.map((option) => {
              const active = filter === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => {
                    if (!pressWasSwipe()) {
                      setFilter(option.id);
                    }
                  }}
                  style={({ pressed }) => [
                    styles.filterChip,
                    {
                      backgroundColor: active
                        ? theme.colors.surface
                        : "transparent",
                      borderColor: active
                        ? theme.colors.border
                        : "transparent",
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterLabel,
                      {
                        color: active
                          ? theme.colors.text
                          : theme.colors.secondaryText,
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {tab === "feed" ? (
          <GestureDetector gesture={feedScroll}>
          <AnimatedSectionList
            animatedProps={scrollProps}
            style={styles.list}
            sections={feedSections}
            keyExtractor={(row) => row.path}
            stickySectionHeadersEnabled
            refreshControl={refreshControl}
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
                selecting={organizer.selecting}
                selected={organizer.isSelected(item.path)}
                onLongPress={() => { if (!pressWasSwipe()) organizer.onRowLongPress(item); }}
                onPress={() => {
                  if (pressWasSwipe()) return;
                  if (organizer.onRowPress(item)) {
                    return;
                  }
                  openScreen("Editor", {
                    path: item.path,
                    title: item.preview.title || "Note",
                  });
                }}
              />
            )}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: theme.colors.secondaryText }]}>
                No notes yet — swipe left and start typing.
              </Text>
            }
          />
          </GestureDetector>
        ) : (
          <GestureDetector gesture={folderScroll}>
          <Animated.FlatList
            animatedProps={scrollProps}
            style={styles.list}
            data={folderRows}
            keyExtractor={(row) => row.folder.path}
            refreshControl={refreshControl}
            renderItem={({ item }) => (
              <FolderTreeRowView
                row={item}
                onToggle={() => {
                  if (!pressWasSwipe()) {
                    setExpanded((current) =>
                      toggleExpanded(current, item.folder.path)
                    );
                  }
                }}
                onOpen={() =>
                  openScreen("Folder", {
                    path: item.folder.path,
                    title: item.folder.name,
                  })
                }
              />
            )}
            ListFooterComponent={
              // Archive is a real system folder full of notes filed from the
              // desktop, but it is not something you browse past — pinned,
              // exactly as the desktop sidebar pins it.
              archive ? (
                <Pressable
                  onPress={() =>
                    openScreen("Folder", {
                      path: ARCHIVE_FOLDER_PATH,
                      title: "Archive",
                    })
                  }
                  style={({ pressed }) => [
                    styles.folderRow,
                    {
                      borderBottomColor: theme.colors.border,
                      opacity: pressed ? 0.6 : 1,
                      paddingLeft: 16,
                    },
                  ]}
                >
                  <View style={styles.pinnedLabel}>
                    <Ionicons
                      name="archive-outline"
                      size={17}
                      color={theme.colors.secondaryText}
                    />
                    <Text
                      style={[styles.folderName, { color: theme.colors.text }]}
                    >
                      Archive
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.folderMeta,
                      { color: theme.colors.secondaryText },
                    ]}
                  >
                    {folderNoteCount(archive) || ""} ›
                  </Text>
                </Pressable>
              ) : null
            }
            ListEmptyComponent={
              <Text style={[styles.empty, { color: theme.colors.secondaryText }]}>
                No folders yet.
              </Text>
            }
          />
          </GestureDetector>
        )}

        {/* App-level destinations, visually set apart from the note/folder
            rows by the grouped card (same surface treatment as the tabs). */}
        <View style={[styles.bottom, { backgroundColor: theme.colors.surface }]}>
          <BottomItem
            icon="sync-outline"
            label="Sync"
            subtitle={syncSubtitle}
            onPress={() => openScreen("Sync")}
            actionLabel={syncBusy ? "Syncing…" : "Sync"}
            actionDisabled={syncBusy}
            onActionPress={quickSync}
          />
          <View style={[styles.bottomSeparator, { backgroundColor: theme.colors.border }]} />
          <BottomItem
            icon="settings-outline"
            label="Settings"
            onPress={() => openScreen("Settings")}
          />
        </View>
        {organizer.overlay}
        </View>
      </View>
  );
};

/**
 * One folder in the tree: a chevron that expands in place, and the name, which
 * opens the folder. The whole nested tree is already in memory (get_tree
 * recurses and reads no bodies), so expanding costs nothing.
 */
const FolderTreeRowView = ({
  row,
  onToggle,
  onOpen,
}: {
  row: FolderTreeRow;
  onToggle: () => void;
  onOpen: () => void;
}) => {
  const theme = useTheme();
  return (
    <View
      style={[styles.treeRow, { borderBottomColor: theme.colors.border }]}
    >
      <Pressable
        onPress={row.hasChildren ? onToggle : undefined}
        hitSlop={8}
        style={[styles.treeChevron, { marginLeft: 16 + row.depth * 16 }]}
      >
        {row.hasChildren ? (
          <Ionicons
            name={row.isExpanded ? "chevron-down" : "chevron-forward"}
            size={15}
            color={theme.colors.secondaryText}
          />
        ) : null}
      </Pressable>
      <Pressable
        onPress={onOpen}
        style={({ pressed }) => [styles.treeMain, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text
          numberOfLines={1}
          style={[styles.folderName, { color: theme.colors.text }]}
        >
          {row.folder.name}
        </Text>
        <Text style={[styles.folderMeta, { color: theme.colors.secondaryText }]}>
          {row.noteCount > 0 ? `${row.noteCount}` : ""} ›
        </Text>
      </Pressable>
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
  actionLabel,
  actionDisabled = false,
  onActionPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  onPress: () => void;
  actionLabel?: string;
  actionDisabled?: boolean;
  onActionPress?: () => void;
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
      {actionLabel && onActionPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          disabled={actionDisabled}
          hitSlop={6}
          onPress={(event) => {
            event.stopPropagation();
            onActionPress();
          }}
          style={({ pressed }) => [
            styles.bottomAction,
            {
              backgroundColor: theme.colors.background,
              borderColor: theme.colors.border,
              opacity: actionDisabled ? 0.5 : pressed ? 0.65 : 1,
            },
          ]}
        >
          <Text style={[styles.bottomActionLabel, { color: theme.colors.text }]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
      <Text style={{ color: theme.colors.secondaryText }}>›</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  menuContent: { flex: 1 },
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
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderName: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  folderMeta: { fontSize: 13 },
  treeRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  treeChevron: { width: 22, alignItems: "center", paddingVertical: 13 },
  treeMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingRight: 16,
    paddingVertical: 13,
  },
  filters: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterLabel: { fontSize: 13, fontWeight: "600" },
  pinnedLabel: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
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
  bottomAction: {
    minWidth: 58,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  bottomActionLabel: { fontSize: 13, fontWeight: "600" },
});
