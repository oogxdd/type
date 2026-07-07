import { DrawerActions, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useLayoutEffect } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import { formatRecordingStatusLabel } from "@typenotes/shared/format";

import { findFolder, folderNoteRows, type NoteRow } from "../lib/feed";
import type { RootStackParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { useTheme, type Theme } from "../theme";

export const NoteListRow = ({
  row,
  onPress,
  theme,
}: {
  row: NoteRow;
  onPress: () => void;
  theme: Theme;
}) => {
  const { preview } = row;
  const subtitle = preview.isRecording && !preview.secondLine
    ? formatRecordingStatusLabel(preview.transcriptionStatus)
    : preview.secondLine;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.colors.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <View style={styles.rowText}>
        <Text
          numberOfLines={1}
          style={[styles.rowTitle, { color: theme.colors.text }]}
        >
          {preview.title || "Empty note"}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={[styles.rowSubtitle, { color: theme.colors.secondaryText }]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.rowDate, { color: theme.colors.secondaryText }]}>
        {preview.dateLabel}
      </Text>
    </Pressable>
  );
};

export const FeedScreen = () => {
  const theme = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const tree = useNotesStore((s) => s.tree);
  const previews = useNotesStore((s) => s.previews);
  const loading = useNotesStore((s) => s.loading);
  const refresh = useNotesStore((s) => s.refresh);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerButtons}>
          <HeaderLink
            label="☰"
            onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
          />
        </View>
      ),
    });
  }, [navigation]);

  const rows = folderNoteRows(findFolder(tree, FEED_FOLDER_PATH), previews);

  return (
    <FlatList
      style={{ backgroundColor: theme.colors.background }}
      data={rows}
      keyExtractor={(row) => row.path}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => void refresh()} />
      }
      renderItem={({ item }) => (
        <NoteListRow
          row={item}
          theme={theme}
          onPress={() =>
            navigation.navigate("Editor", {
              path: item.path,
              title: item.preview.title || "Note",
            })
          }
        />
      )}
      ListEmptyComponent={
        <Text style={[styles.empty, { color: theme.colors.secondaryText }]}>
          Nothing here yet — go back and start typing.
        </Text>
      }
    />
  );
};

const HeaderLink = ({ label, onPress }: { label: string; onPress: () => void }) => {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={6}>
      {({ pressed }) => (
        <Text
          style={[
            styles.headerLink,
            { color: theme.colors.accent, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  headerButtons: { flexDirection: "row", gap: 16 },
  headerLink: { fontSize: 15, fontWeight: "500" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: "500" },
  rowSubtitle: { fontSize: 13 },
  rowDate: { fontSize: 12 },
  empty: { textAlign: "center", marginTop: 48, fontSize: 14 },
});
