import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  effectiveTranscriptionMode,
  type TranscriptionMode,
} from "@typenotes/shared/types";

import { activeProfile, useSettingsStore } from "../state/settings-store";
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
    label: "Native (on-device)",
    description: "Use a device speech recognizer plugged in through the native provider API.",
  },
  {
    mode: "off",
    label: "Off",
    description: "Never transcribe automatically.",
  },
];

export const SettingsScreen = () => {
  const theme = useTheme();
  const store = useSettingsStore();
  const snapshot = store.snapshot;
  const profile = activeProfile(snapshot);

  const [newFolderName, setNewFolderName] = useState("");
  const [notesRoot, setNotesRoot] = useState(profile?.notes_root ?? "");
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
      {store.demoMode ? (
        <InlineNote>
          Demo mode: the native Rust core is not linked in this build, so
          everything above operates on in-memory data.
        </InlineNote>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
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
