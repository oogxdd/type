// Selecting notes and acting on them, shared by every list that shows notes.
//
// Hold a row to get its actions; from there, "Select more…" turns the list
// into a checklist with a batch bar at the bottom — reviewing a feed means
// filing a dozen notes, not one. The screen keeps the list; this keeps the
// selection, the sheet, the folder picker and the confirmations.

import { useCallback, useState, type ReactNode } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getErrorMessage } from "@typenotes/shared/errors";
import type { FolderNode } from "@typenotes/shared/types";

import type { NoteRow } from "../lib/feed";
import { useNotesStore } from "../state/notes-store";
import { useTheme } from "../theme";
import { FolderPickerModal } from "./folder-picker";
import { NoteActionsSheet, type NoteSheetAction } from "./note-actions-sheet";

export type NoteOrganizer = {
  selecting: boolean;
  isSelected: (path: string) => boolean;
  selectedCount: number;
  /** Hold a row. While selecting, this just toggles it. */
  onRowLongPress: (row: NoteRow) => void;
  /**
   * Tap a row. Returns true when the tap was consumed by selection, so the
   * caller only opens the note when it returns false.
   */
  onRowPress: (row: NoteRow) => boolean;
  exitSelection: () => void;
  /** Modals and the batch bar. Render last, inside the screen's root view. */
  overlay: ReactNode;
};

export const useNoteOrganizer = (tree: FolderNode | null): NoteOrganizer => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const moveNotes = useNotesStore((state) => state.moveNotes);
  const deleteNotes = useNotesStore((state) => state.deleteNotes);
  const setArchived = useNotesStore((state) => state.setArchived);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [sheetRow, setSheetRow] = useState<NoteRow | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  const toggle = useCallback((path: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(path)) {
        next.add(path);
      }
      return next;
    });
  }, []);

  const onRowLongPress = useCallback(
    (row: NoteRow) => {
      if (selecting) {
        toggle(row.path);
        return;
      }
      setSheetRow(row);
    },
    [selecting, toggle]
  );

  const onRowPress = useCallback(
    (row: NoteRow) => {
      if (!selecting) {
        return false;
      }
      toggle(row.path);
      return true;
    },
    [selecting, toggle]
  );

  const report = (error: unknown) => {
    Alert.alert("Could not finish", getErrorMessage(error));
  };

  const runArchive = useCallback(
    (paths: string[], archived: boolean) => {
      // No bulk marker command in the core — one call per note, in order, so a
      // failure part-way still leaves the earlier ones done.
      void (async () => {
        try {
          for (const path of paths) {
            await setArchived(path, archived);
          }
        } catch (error) {
          report(error);
        }
      })();
    },
    [setArchived]
  );

  const confirmDelete = useCallback(
    (paths: string[]) => {
      Alert.alert(
        paths.length > 1 ? `Delete ${paths.length} notes?` : "Delete this note?",
        "This cannot be undone from the phone.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              void deleteNotes(paths).catch(report);
              exitSelection();
            },
          },
        ]
      );
    },
    [deleteNotes, exitSelection]
  );

  // The picker outlives the sheet that opened it, so it remembers its targets.
  const [pendingMove, setPendingMove] = useState<string[]>([]);
  const openPickerFor = useCallback((paths: string[]) => {
    setPendingMove(paths);
    setPickerOpen(true);
  }, []);

  const handleSheetAction = useCallback(
    (row: NoteRow, action: NoteSheetAction) => {
      setSheetRow(null);
      switch (action) {
        case "archive":
          runArchive([row.path], true);
          break;
        case "unarchive":
          runArchive([row.path], false);
          break;
        case "move":
          openPickerFor([row.path]);
          break;
        case "delete":
          confirmDelete([row.path]);
          break;
        case "select":
          setSelecting(true);
          setSelected(new Set([row.path]));
          break;
      }
    },
    [confirmDelete, openPickerFor, runArchive]
  );

  const overlay = (
    <>
      {selecting ? (
        <View
          style={[
            styles.batchBar,
            {
              backgroundColor: theme.colors.surface,
              borderTopColor: theme.colors.border,
              paddingBottom: insets.bottom + 10,
            },
          ]}
        >
          <Text style={[styles.batchCount, { color: theme.colors.secondaryText }]}>
            {selected.size === 0
              ? "Select notes"
              : `${selected.size} selected`}
          </Text>
          <View style={styles.batchActions}>
            <BatchAction
              label="Archive"
              disabled={selected.size === 0}
              onPress={() => {
                runArchive([...selected], true);
                exitSelection();
              }}
            />
            <BatchAction
              label="Move"
              disabled={selected.size === 0}
              onPress={() => openPickerFor([...selected])}
            />
            <BatchAction
              label="Delete"
              destructive
              disabled={selected.size === 0}
              onPress={() => confirmDelete([...selected])}
            />
            <BatchAction label="Done" onPress={exitSelection} />
          </View>
        </View>
      ) : null}

      <NoteActionsSheet
        visible={sheetRow !== null}
        title={sheetRow?.preview.title ?? ""}
        archived={sheetRow?.preview.isArchived ?? false}
        count={1}
        onAction={(action) => {
          if (sheetRow) {
            handleSheetAction(sheetRow, action);
          }
        }}
        onClose={() => setSheetRow(null)}
      />

      <FolderPickerModal
        visible={pickerOpen}
        tree={tree}
        heading={
          pendingMove.length > 1
            ? `Move ${pendingMove.length} notes`
            : "Move note"
        }
        onPick={(destination) => {
          setPickerOpen(false);
          void moveNotes(pendingMove, destination).catch(report);
          exitSelection();
        }}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );

  return {
    selecting,
    isSelected: (path) => selected.has(path),
    selectedCount: selected.size,
    onRowLongPress,
    onRowPress,
    exitSelection,
    overlay,
  };
};

const BatchAction = ({
  label,
  onPress,
  disabled,
  destructive,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) => {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.batchButton,
        { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
      ]}
    >
      <Text
        style={[
          styles.batchButtonText,
          { color: destructive ? theme.colors.danger : theme.colors.accent },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  batchBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    paddingHorizontal: 12,
  },
  batchCount: { fontSize: 12, textAlign: "center", paddingBottom: 6 },
  batchActions: { flexDirection: "row", justifyContent: "space-around" },
  batchButton: { paddingVertical: 8, paddingHorizontal: 10 },
  batchButtonText: { fontSize: 16 },
});
