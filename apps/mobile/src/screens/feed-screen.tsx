import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import { formatRecordingStatusLabel } from "@typenotes/shared/format";

import { feedNoteRows, findFolder, groupNoteRowsByDate, type NoteRow } from "../lib/feed";
import type { RootStackParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { useTheme, type Theme } from "../theme";

export const NoteListRow = ({
  row,
  onPress,
  onLongPress,
  selecting = false,
  selected = false,
  theme,
}: {
  row: NoteRow;
  onPress: () => void;
  onLongPress?: () => void;
  /** The list is a checklist right now: show the box on every row. */
  selecting?: boolean;
  selected?: boolean;
  theme: Theme;
}) => {
  const { preview } = row;
  const subtitle = preview.isRecording && !preview.secondLine
    ? formatRecordingStatusLabel(preview.transcriptionStatus)
    : preview.secondLine;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      // Matches the hold used elsewhere in the app (the dictation button).
      delayLongPress={400}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.colors.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      {selecting ? (
        <Ionicons
          name={selected ? "checkmark-circle" : "ellipse-outline"}
          size={22}
          color={selected ? theme.colors.accent : theme.colors.secondaryText}
        />
      ) : null}
      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          {preview.isArchived ? (
            <Ionicons
              name="archive"
              size={13}
              color={theme.colors.secondaryText}
            />
          ) : null}
          <Text
            numberOfLines={1}
            style={[
              styles.rowTitle,
              {
                color: theme.colors.text,
                // A row whose body has not been read yet shows a title derived
                // from its file name; don't present that as the real thing.
                opacity: row.pending ? 0.5 : 1,
              },
            ]}
          >
            {preview.title || "Empty note"}
          </Text>
        </View>
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

  const rows = feedNoteRows(findFolder(tree, FEED_FOLDER_PATH), previews);
  const sections = groupNoteRowsByDate(rows);

  return (
    <SectionList
      style={{ backgroundColor: theme.colors.background }}
      sections={sections}
      keyExtractor={(row) => row.path}
      stickySectionHeadersEnabled
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => void refresh()} />
      }
      renderSectionHeader={({ section }) => (
        <View
          style={[styles.sectionHeader, { backgroundColor: theme.colors.background }]}
        >
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

const styles = StyleSheet.create({
  sectionHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  sectionHeaderText: { fontSize: 13, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  rowTitle: { fontSize: 16, fontWeight: "500", flexShrink: 1 },
  rowSubtitle: { fontSize: 13 },
  rowDate: { fontSize: 12 },
  empty: { textAlign: "center", marginTop: 48, fontSize: 14 },
});
