// Settings is a two-level menu: this file's default export lands on a list
// of sections, each of which pushes into its own dedicated screen (also
// exported from here) rather than showing everything in one long scroll.

import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  effectiveTranscriptionMode,
  type TranscriptionMode,
} from "@typenotes/shared/types";

import type { RootStackParamList } from "../navigation";
import { activeProfile, useSettingsStore } from "../state/settings-store";
import { useUiPrefsStore, type MenuSide } from "../state/ui-prefs-store";
import { useTheme } from "../theme";
import { Button, Field, InlineNote, Section } from "../ui/controls";

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

const MODE_LABEL: Record<TranscriptionMode, string> = Object.fromEntries(
  MODES.map(({ mode, label }) => [mode, label])
) as Record<TranscriptionMode, string>;

// Experiment: which side the menu opens from on the home page (device-local).
const MENU_SIDES: { side: MenuSide; label: string; description: string }[] = [
  {
    side: "left",
    label: "Left",
    description:
      "Hamburger top-left; swipe from the left edge to open, from the right edge to close.",
  },
  {
    side: "right",
    label: "Right",
    description:
      "Hamburger top-right; swipe from the right edge to open, from the left edge to close.",
  },
];

export const SettingsScreen = () => {
  const theme = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const snapshot = useSettingsStore((s) => s.snapshot);
  const demoMode = useSettingsStore((s) => s.demoMode);
  const menuSide = useUiPrefsStore((s) => s.menuSide);
  const setMenuSide = useUiPrefsStore((s) => s.setMenuSide);
  const profile = activeProfile(snapshot);
  const currentMode = profile ? effectiveTranscriptionMode(profile.settings) : null;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
    >
      <MenuRow
        icon="folder-outline"
        title="Working Folders"
        subtitle={profile?.name ?? "No working folder yet"}
        onPress={() => navigation.navigate("SettingsWorkingFolders")}
      />
      <MenuRow
        icon="mic-outline"
        title="Transcription"
        subtitle={currentMode ? MODE_LABEL[currentMode] : "Not set"}
        onPress={() => navigation.navigate("SettingsTranscription")}
      />

      <Section title="Menu side">
        {MENU_SIDES.map(({ side, label, description }) => {
          const selected = menuSide === side;
          return (
            <Pressable
              key={side}
              onPress={() => setMenuSide(side)}
              style={({ pressed }) => [
                styles.modeRow,
                {
                  borderColor: selected ? theme.colors.accent : theme.colors.border,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                {label}
                {selected ? "  ✓" : ""}
              </Text>
              <Text style={{ color: theme.colors.secondaryText, fontSize: 12 }}>
                {description}
              </Text>
            </Pressable>
          );
        })}
      </Section>

      {demoMode ? (
        <InlineNote>
          Demo mode: the native Rust core is not linked in this build, so
          everything above operates on in-memory data.
        </InlineNote>
      ) : null}
    </ScrollView>
  );
};

const MenuRow = ({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) => {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        { borderColor: theme.colors.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <View style={[styles.menuRowIcon, { backgroundColor: theme.colors.surface }]}>
        <Ionicons name={icon} size={18} color={theme.colors.text} />
      </View>
      <View style={styles.menuRowText}>
        <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 16 }}>
          {title}
        </Text>
        <Text
          numberOfLines={1}
          style={{ color: theme.colors.secondaryText, fontSize: 13 }}
        >
          {subtitle}
        </Text>
      </View>
      <Text style={{ color: theme.colors.secondaryText }}>›</Text>
    </Pressable>
  );
};

export const SettingsWorkingFoldersScreen = () => {
  const theme = useTheme();
  const store = useSettingsStore();
  const snapshot = store.snapshot;
  const profile = activeProfile(snapshot);

  const [newFolderName, setNewFolderName] = useState("");
  const [notesRoot, setNotesRoot] = useState(profile?.notes_root ?? "");

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
    >
      <Section title="Working folders">
        {snapshot?.profiles.map((p) => {
          const active = p.id === snapshot.active_profile_id;
          return (
            <Pressable
              key={p.id}
              disabled={active}
              onPress={() => void store.switchWorkingFolder(p.id).catch(() => {})}
              style={({ pressed }) => [
                styles.profileRow,
                {
                  borderColor: active ? theme.colors.accent : theme.colors.border,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <View style={styles.profileText}>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                  {p.name}
                  {active ? "  ✓" : ""}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ color: theme.colors.secondaryText, fontSize: 12 }}
                >
                  {p.notes_root}
                </Text>
              </View>
            </Pressable>
          );
        })}
        <Field
          label="New working folder"
          value={newFolderName}
          onChangeText={setNewFolderName}
          placeholder="e.g. Journal"
        />
        <Button
          title="Create"
          kind="secondary"
          disabled={!newFolderName.trim()}
          onPress={() =>
            void store
              .createWorkingFolder(newFolderName.trim())
              .then(() => setNewFolderName(""))
              .catch(() => {})
          }
        />
        <InlineNote>
          Each working folder is just a directory of markdown files with its own
          .type/settings.json (git remote, transcription mode). The app's
          Documents directory is visible in the Files app, so your notes are
          always reachable outside the app.
        </InlineNote>
      </Section>

      {profile ? (
        <Section title="Folder location">
          <Field
            label={`Notes root for “${profile.name}” (absolute path)`}
            value={notesRoot}
            onChangeText={setNotesRoot}
          />
          <Button
            title="Move folder"
            kind="secondary"
            disabled={!notesRoot.trim() || notesRoot === profile.notes_root}
            onPress={() =>
              void store.setNotesRoot(profile.id, notesRoot.trim()).catch(() => {})
            }
          />
          <InlineNote>
            Existing content is moved to the new location.
          </InlineNote>
        </Section>
      ) : null}

      {store.error ? (
        <Text style={{ color: theme.colors.danger }}>{store.error}</Text>
      ) : null}
    </ScrollView>
  );
};

export const SettingsTranscriptionScreen = () => {
  const theme = useTheme();
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
      contentContainerStyle={styles.content}
    >
      <Section title="Transcription">
        {MODES.map(({ mode, label, description }) => {
          const selected = currentMode === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => void store.setTranscriptionMode(mode).catch(() => {})}
              style={({ pressed }) => [
                styles.modeRow,
                {
                  borderColor: selected ? theme.colors.accent : theme.colors.border,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                {label}
                {selected ? "  ✓" : ""}
              </Text>
              <Text style={{ color: theme.colors.secondaryText, fontSize: 12 }}>
                {description}
              </Text>
            </Pressable>
          );
        })}
        {modeIsLegacyDerived ? (
          <InlineNote>
            Mode derived from this folder's legacy auto-transcription setting —
            pick one to persist it explicitly.
          </InlineNote>
        ) : null}
        <Field
          label="AssemblyAI API key (stored on this device only)"
          value={assemblyKey}
          onChangeText={setAssemblyKey}
          secureTextEntry
        />
        <Button
          title="Save key"
          kind="secondary"
          onPress={() => void store.saveAssemblyAiKey(assemblyKey).catch(() => {})}
        />
      </Section>

      {store.error ? (
        <Text style={{ color: theme.colors.danger }}>{store.error}</Text>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  menuRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  menuRowText: { flex: 1, gap: 2 },
  profileRow: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  profileText: { gap: 2 },
  modeRow: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 2,
  },
});
