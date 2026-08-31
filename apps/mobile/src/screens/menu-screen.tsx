// The app menu — the root of the stack: close button + Feed / Folders tabs
// on top (inline note + folder lists), Sync and Settings pinned at the
// bottom. The capture page sits pushed above it, so its hamburger or a
// swipe-back pops here; the close button pushes a fresh capture page back
// in, and a leftward swipe anywhere drags a preview of it in with the finger
// (see swipeToCapture below). Everything else is pushed from here, so
// swipe-back from Sync/Settings/Folder/Editor lands back on the menu.

import { Ionicons } from "@expo/vector-icons";
import { CommonActions, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  InteractionManager,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ARCHIEVE_FOLDER_PATH,
  FEED_FOLDER_PATH,
} from "@typenotes/shared/constants";
import { matchesFeedFilter, type FeedNoteFilter } from "@typenotes/shared/note-filter";

import {
  feedNoteRows,
  findFolder,
  folderNoteCount,
  groupNoteRowsByDate,
} from "../lib/feed";
import {
  flattenFolderTree,
  toggleExpanded,
  type FolderTreeRow,
} from "../lib/folder-tree";
import { formatRelativeTime } from "../lib/relative-time";
import { autoSyncLabel } from "../lib/sync-experience";
import type { RootStackParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { useSyncStore } from "../state/sync-store";
import { useTheme } from "../theme";
import { useNoteOrganizer } from "../ui/note-organizer";
import { ToolbarButton } from "../ui/toolbar-button";
import { NoteListRow } from "./feed-screen";

type MenuTab = "feed" | "folders";

// The subset of the desktop's filter chips that matches what the phone can
// set: archiving is the one marker the note sheet writes.
const FEED_FILTERS: Array<{ id: FeedNoteFilter; label: string }> = [
  { id: "active", label: "Active" },
  { id: "all", label: "All" },
  { id: "archived", label: "Archived" },
];

// Releasing the drag past this fraction of the screen (or flicking faster
// than this, px/s leftward) commits to the capture page.
const OPEN_CAPTURE_PROGRESS = 0.3;
const OPEN_CAPTURE_VELOCITY = -500;
// How far the menu slides left behind the incoming page — the depth effect
// of a native iOS push.
const MENU_PARALLAX = 0.3;

export const MenuScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width } = useWindowDimensions();
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

  // 0..1 — how far the capture-page preview has slid in over the menu.
  // Driven on the UI thread by the pan below; at 1 the real Capture screen
  // is pushed underneath it with animation:none (there is no native
  // interactive *push* gesture, so this hand-rolls one — the preview is a
  // pixel replica of the blank capture page, and the swap is invisible).
  const captureProgress = useSharedValue(0);

  const menuDepthStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -width * MENU_PARALLAX * captureProgress.value }],
  }));
  const dimStyle = useAnimatedStyle(() => ({
    opacity: 0.08 * captureProgress.value,
  }));
  const capturePreviewStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: width * (1 - captureProgress.value) }],
    // At rest the preview sits exactly one screen-width to the right — but
    // during a native pop the whole menu view (preview included) slides in
    // from -30% parallax, which would poke the preview's left edge (its
    // hamburger replica) into the top-right of the frame. Hide it whenever
    // the menu's own gesture isn't driving it.
    opacity: captureProgress.value > 0 ? 1 : 0,
  }));

  // RNGH's pan activating does not reliably cancel React Native's own
  // responder (and by claiming the gesture it also keeps the lists' scroll
  // from doing that cancelling), so a swipe that starts on a row/button can
  // still fire its onPress on release. A genuine tap never moves the pan, so
  // any preview progress at press time means the touch was a swipe: drop it.
  const pressWasSwipe = () => captureProgress.value > 0.001;

  const openScreen = <Screen extends keyof RootStackParamList>(
    screen: Screen,
    params?: RootStackParamList[Screen]
  ) => {
    if (pressWasSwipe()) {
      return;
    }
    navigation.dispatch(CommonActions.navigate({ name: screen, params }));
  };

  const selectTab = (next: MenuTab) => {
    if (!pressWasSwipe()) {
      setTab(next);
    }
  };

  const openCapture = () => {
    if (pressWasSwipe()) {
      return;
    }
    navigation.navigate("Capture");
  };
  const openCaptureBehindPreview = useCallback(() => {
    navigation.navigate("Capture", { instant: true });
    // Drop the preview once the pushed screen is attached on top of the
    // menu. There is no native "attached" signal with animation:none; the
    // delay just has to outlive the mount, and only a back swipe started
    // within it could glimpse the reset.
    setTimeout(() => {
      captureProgress.value = 0;
    }, 400);
  }, [captureProgress, navigation]);

  // The gesture below is memoized, so it must not capture a per-render
  // function: the UI runtime keeps the remote-function handle it was
  // serialized with for as long as the timing animation runs. Same reason the
  // window width becomes a shared value.
  const openCaptureRef = useRef(openCaptureBehindPreview);
  openCaptureRef.current = openCaptureBehindPreview;
  const runOpenCapture = useCallback(() => openCaptureRef.current(), []);

  const windowW = useSharedValue(width);
  useEffect(() => {
    windowW.value = width;
  }, [width, windowW]);

  // The whole menu is the gesture surface: a clearly-leftward drag anywhere
  // (16px of horizontal travel) pulls the capture-page preview in with the
  // finger. Presses under the swipe are filtered by pressWasSwipe above;
  // vertical drags fail fast and stay with the note/folder lists.
  const swipeToCapture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX(-16)
        .failOffsetX(24)
        .failOffsetY([-20, 20])
        .onUpdate((event) => {
          captureProgress.value = Math.min(
            1,
            Math.max(0, -event.translationX / Math.max(windowW.value, 1))
          );
        })
        .onEnd((event, success) => {
          // RNGH calls END on cancellation too; opening Capture from a gesture
          // the system took away is not what the finger asked for.
          if (!success) {
            captureProgress.value = withTiming(0, { duration: 180 });
            return;
          }
          const shouldOpen =
            captureProgress.value > OPEN_CAPTURE_PROGRESS ||
            event.velocityX < OPEN_CAPTURE_VELOCITY;
          if (shouldOpen) {
            captureProgress.value = withTiming(
              1,
              { duration: 160, easing: Easing.out(Easing.cubic) },
              (finished) => {
                if (finished) {
                  runOnJS(runOpenCapture)();
                }
              }
            );
          } else {
            captureProgress.value = withTiming(0, { duration: 180 });
          }
        }),
    [captureProgress, runOpenCapture, windowW]
  );

  const lastSyncedMs = useSyncStore((s) => s.history[0]?.authored_ms ?? null);
  const autoSyncState = useSyncStore((s) => s.autoSyncState);
  const syncSubtitle =
    autoSyncLabel(autoSyncState) ?? `Last synced ${formatRelativeTime(lastSyncedMs)}`;

  // Boot pushes Capture on top of the menu in the same first React commit,
  // so building the note/folder lists here would sit on the app's
  // first-paint path. Render an empty page for the first tick and fill in
  // right after — done long before a swipe can reveal the menu.
  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setContentReady(true));
    return () => task.cancel();
  }, []);
  if (!contentReady) {
    return <View style={[styles.root, { backgroundColor: theme.colors.background }]} />;
  }

  const feedRows = feedNoteRows(findFolder(tree, FEED_FOLDER_PATH), previews, {
    keep: (preview) => matchesFeedFilter(preview, filter),
  });
  const feedSections = groupNoteRowsByDate(feedRows);
  const folderRows = flattenFolderTree(tree, expanded);
  const archive = findFolder(tree, ARCHIEVE_FOLDER_PATH);

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
    <GestureDetector gesture={swipeToCapture}>
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <Animated.View
          style={[
            styles.menuContent,
            { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 },
            menuDepthStyle,
          ]}
        >
        <View style={styles.topBar}>
          <ToolbarButton icon="close-outline" onPress={openCapture} />
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
          <SectionList
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
                onLongPress={() => organizer.onRowLongPress(item)}
                onPress={() => {
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
        ) : (
          <FlatList
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
                      path: ARCHIEVE_FOLDER_PATH,
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
        )}

        {/* App-level destinations, visually set apart from the note/folder
            rows by the grouped card (same surface treatment as the tabs). */}
        <View style={[styles.bottom, { backgroundColor: theme.colors.surface }]}>
          <BottomItem
            icon="sync-outline"
            label="Sync"
            subtitle={syncSubtitle}
            onPress={() => openScreen("Sync")}
          />
          <View style={[styles.bottomSeparator, { backgroundColor: theme.colors.border }]} />
          <BottomItem
            icon="settings-outline"
            label="Settings"
            onPress={() => openScreen("Settings")}
          />
        </View>
        {organizer.overlay}
        </Animated.View>

        {/* Native-push depth cues: the menu dims while the preview page
            rides in above it, casting a shadow over the seam. */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.dim, dimStyle]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.capturePreview,
            { backgroundColor: theme.colors.background },
            capturePreviewStyle,
          ]}
        >
          <Text
            style={[
              styles.previewPlaceholder,
              { color: theme.colors.secondaryText, marginTop: insets.top + 56 },
            ]}
          >
            Start typing…
          </Text>
          <View
            style={[
              styles.previewButton,
              {
                left: 20,
                top: insets.top + 8,
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <Ionicons name="menu-outline" size={20} color={theme.colors.text} />
          </View>
          <View
            style={[
              styles.previewButton,
              styles.previewMic,
              {
                right: 32,
                bottom: insets.bottom + 36,
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <Ionicons name="mic-outline" size={22} color={theme.colors.text} />
          </View>
        </Animated.View>
      </View>
    </GestureDetector>
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
  menuContent: { flex: 1 },
  dim: { backgroundColor: "#000" },
  capturePreview: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    shadowColor: "#000",
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  // The preview mirrors the blank capture page (capture-screen.tsx): page
  // padding top +12 / horizontal 20, input paddingTop 44, 17pt text, and the
  // toolbar circle geometry from ToolbarButton / DictationButton.
  previewPlaceholder: { paddingHorizontal: 20, fontSize: 17, lineHeight: 26 },
  previewButton: {
    position: "absolute",
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  previewMic: { width: 44, height: 44, borderRadius: 22 },
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
});
