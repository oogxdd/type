// Settings is a two-level menu: this file's default export lands on a list
// of sections, each of which pushes into its own dedicated screen (also
// exported from here) rather than showing everything in one long scroll.
// All three screens use the iOS inset-grouped list kit in ui/settings-list.

import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  effectiveTranscriptionMode,
  type TranscriptionMode,
} from "@typenotes/shared/types";

import type { RootStackParamList } from "../navigation";
import { activeProfile, useSettingsStore } from "../state/settings-store";
import { useTheme } from "../theme";
import {
  SettingsActionRow,
  SettingsFieldRow,
  SettingsGroup,
  SettingsRow,
} from "../ui/settings-list";

const MODES: { mode: TranscriptionMode; label: string; description: string }[] = [
  {
    mode: "assemblyai",
    label: "AssemblyAI (on this phone)",
    description: "Transcribe right after recording via the AssemblyAI cloud API.",
  },
  {
    mode: "desktop",
    label: "On my desktop",
    description: "Leave recordings pending; a synced desktop transcribes them with local Whisper.",
  },
  {
    mode: "native",
    label: "On this phone (on-device)",
    description:
      "Transcribe right after recording with the system speech recognizer — private, works offline.",
  },
  {
    mode: "off",
    label: "Off",
    description: "Never transcribe automatically.",
  },
];

// Short names for the value slot on the settings menu row.
const MODE_VALUE: Record<TranscriptionMode, string> = {
  assemblyai: "AssemblyAI",
  desktop: "Desktop",
  native: "On-device",
  off: "Off",
};

// iOS Settings-style icon tile colors (fixed, theme-independent).
const TILE_BLUE = "#007aff";
const TILE_ORANGE = "#ff9500";

export const SettingsScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const snapshot = useSettingsStore((s) => s.snapshot);
  const demoMode = useSettingsStore((s) => s.demoMode);
  const profile = activeProfile(snapshot);
  const currentMode = profile ? effectiveTranscriptionMode(profile.settings) : null;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
    >
      <SettingsGroup
        separatorInset={57}
        footer={
          demoMode
            ? "Demo mode: the native Rust core is not linked in this build, so everything above operates on in-memory data."
            : undefined
        }
      >
        <SettingsRow
          icon="folder-outline"
          iconColor={TILE_BLUE}
          title="Working Folders"
          value={profile?.name ?? "None"}
          chevron
          onPress={() => navigation.navigate("SettingsWorkingFolders")}
        />
        <SettingsRow
          icon="mic-outline"
          iconColor={TILE_ORANGE}
          title="Transcription"
          value={currentMode ? MODE_VALUE[currentMode] : "Not set"}
          chevron
          onPress={() => navigation.navigate("SettingsTranscription")}
        />
      </SettingsGroup>
    </ScrollView>
  );
};

export const SettingsWorkingFoldersScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const store = useSettingsStore();
  const snapshot = store.snapshot;
  const profile = activeProfile(snapshot);

  const [newFolderName, setNewFolderName] = useState("");
  const [notesRoot, setNotesRoot] = useState(profile?.notes_root ?? "");

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
    >
      <SettingsGroup
        header="Working folders"
        footer="Each working folder is a directory of markdown files with its own settings (git remote, transcription mode). The app's Documents directory is visible in the Files app, so your notes are always reachable outside the app."
      >
        {snapshot?.profiles.map((p) => {
          const active = p.id === snapshot.active_profile_id;
          return (
            <SettingsRow
              key={p.id}
              title={p.name}
              subtitle={p.notes_root}
              checked={active}
              disabled={active}
              onPress={() => void store.switchWorkingFolder(p.id).catch(() => {})}
            />
          );
        })}
      </SettingsGroup>

      <SettingsGroup header="New working folder">
        <SettingsFieldRow
          value={newFolderName}
          onChangeText={setNewFolderName}
          placeholder="Name, e.g. Journal"
        />
        <SettingsActionRow
          title="Create"
          disabled={!newFolderName.trim()}
          onPress={() =>
            void store
              .createWorkingFolder(newFolderName.trim())
              .then(() => setNewFolderName(""))
              .catch(() => {})
          }
        />
      </SettingsGroup>

      {profile ? (
        <SettingsGroup
          header={`Folder location — ${profile.name}`}
          footer="Existing content is moved to the new location."
        >
          <SettingsFieldRow
            value={notesRoot}
            onChangeText={setNotesRoot}
            placeholder="Absolute path"
          />
          <SettingsActionRow
            title="Move Folder"
            disabled={!notesRoot.trim() || notesRoot === profile.notes_root}
            onPress={() =>
              void store.setNotesRoot(profile.id, notesRoot.trim()).catch(() => {})
            }
          />
        </SettingsGroup>
      ) : null}

      {store.error ? (
        <Text style={[styles.error, { color: theme.colors.danger }]}>{store.error}</Text>
      ) : null}
    </ScrollView>
  );
};

export const SettingsTranscriptionScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const store = useSettingsStore();
  const snapshot = store.snapshot;
  const profile = activeProfile(snapshot);

  const [assemblyKey, setAssemblyKey] = useState(
    snapshot?.app_config.assemblyai_api_key ?? ""
  );

  const currentMode = profile ? effectiveTranscriptionMode(profile.settings) : null;
  const modeIsLegacyDerived = profile
    ? profile.settings.transcription_mode == null
    : false;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
    >
      <SettingsGroup
        header="Transcribe voice notes"
        footer={
          modeIsLegacyDerived
            ? "Mode derived from this folder's legacy auto-transcription setting — pick one to persist it explicitly."
            : undefined
        }
      >
        {MODES.map(({ mode, label, description }) => (
          <SettingsRow
            key={mode}
            title={label}
            subtitle={description}
            checked={currentMode === mode}
            onPress={() => void store.setTranscriptionMode(mode).catch(() => {})}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup
        header="AssemblyAI API key"
        footer="Stored on this device only — never synced."
      >
        <SettingsFieldRow
          value={assemblyKey}
          onChangeText={setAssemblyKey}
          placeholder="API key"
          secureTextEntry
        />
        <SettingsActionRow
          title="Save Key"
          onPress={() => void store.saveAssemblyAiKey(assemblyKey).catch(() => {})}
        />
      </SettingsGroup>

      {store.error ? (
        <Text style={[styles.error, { color: theme.colors.danger }]}>{store.error}</Text>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: { padding: 16, paddingTop: 20 },
  error: { fontSize: 13, marginHorizontal: 16 },
});
