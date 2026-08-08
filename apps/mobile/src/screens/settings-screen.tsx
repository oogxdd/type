// Settings is a two-level menu: this file's default export lands on a list
// of sections, each of which pushes into its own dedicated screen (also
// exported from here) rather than showing everything in one long scroll.
// All three screens use the iOS inset-grouped list kit in ui/settings-list.

import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getErrorMessage } from "@typenotes/shared/errors";
import {
  effectiveTranscriptionMode,
  type TranscriptionMode,
} from "@typenotes/shared/types";

import {
  backgroundLabel,
  BACKGROUNDS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  resolveBackground,
  resolveTextColor,
  TEXT_COLORS,
} from "../lib/appearance";
import {
  assemblySetupNotice,
  hasStoredKey,
  isKeyActionDisabled,
  type KeyCheck,
  keyActionTitle,
  maskApiKey,
  queuedRecordingsNotice,
  type SetupNotice,
  transcriptionRowValue,
} from "../lib/assembly-setup";
import type { RootStackParamList } from "../navigation";
import { useAppearanceStore } from "../state/appearance-store";
import { activeProfile, useSettingsStore } from "../state/settings-store";
import { useTheme } from "../theme";
import {
  SettingsActionRow,
  SettingsFieldRow,
  SettingsGroup,
  SettingsNoticeRow,
  SettingsRow,
  SettingsStepperRow,
  SettingsSwatchRow,
} from "../ui/settings-list";

// Two of these transcribe automatically the moment a recording is saved and
// two deliberately don't — that is the whole point of the list. Picking
// "On my desktop" keeps voice notes off the cloud entirely and hands them to
// the desktop's local Whisper after sync; the manual action further down still
// lets a phone push a batch to AssemblyAI on demand.
const MODES: { mode: TranscriptionMode; label: string; description: string }[] = [
  {
    mode: "assemblyai",
    label: "AssemblyAI (on this phone)",
    description: "Automatic: upload to the AssemblyAI cloud API right after each recording.",
  },
  {
    mode: "desktop",
    label: "On my desktop",
    description:
      "Manual: recordings stay pending and your synced desktop transcribes them locally, free and private.",
  },
  {
    mode: "native",
    label: "On this phone (on-device)",
    description:
      "Automatic: the system speech recognizer transcribes after each recording — private, works offline.",
  },
  {
    mode: "off",
    label: "Off",
    description: "Never transcribe automatically. Recordings stay pending until you say so.",
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
const TILE_PURPLE = "#af52de";

const FONT_SIZE_STEP = 1;

const PREVIEW_TEXT =
  "The blank page is the whole app. Start typing, swipe up, and it files itself.";

export const SettingsScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const snapshot = useSettingsStore((s) => s.snapshot);
  const demoMode = useSettingsStore((s) => s.demoMode);
  const appearance = useAppearanceStore((s) => s.appearance);
  const profile = activeProfile(snapshot);
  const currentMode = profile ? effectiveTranscriptionMode(profile.settings) : null;
  // A mode that can't run has to show as broken from here — otherwise the
  // phone reads as configured while every recording quietly stays pending.
  const transcriptionValue = currentMode
    ? transcriptionRowValue(
        MODE_VALUE[currentMode],
        currentMode === "assemblyai",
        snapshot?.app_config.assemblyai_api_key ?? ""
      )
    : "Not set";

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
          value={transcriptionValue}
          chevron
          onPress={() => navigation.navigate("SettingsTranscription")}
        />
        <SettingsRow
          icon="color-palette-outline"
          iconColor={TILE_PURPLE}
          title="Appearance"
          value={backgroundLabel(appearance.background)}
          chevron
          onPress={() => navigation.navigate("SettingsAppearance")}
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

/**
 * Background, text color, and editor text size — all device-local. The whole
 * screen repaints from the live theme as you tap, so the settings UI itself is
 * the preview for the colors; the bordered sample below is there for the text
 * size, which only applies to the capture page and the note editor.
 */
export const SettingsAppearanceScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const systemDark = useColorScheme() === "dark";
  const appearance = useAppearanceStore((s) => s.appearance);
  const setBackground = useAppearanceStore((s) => s.setBackground);
  const setTextColor = useAppearanceStore((s) => s.setTextColor);
  const setFontSize = useAppearanceStore((s) => s.setFontSize);
  const reset = useAppearanceStore((s) => s.reset);

  // "System" swatches are resolved to what the phone is showing right now, and
  // text swatches are drawn on the chosen background, so both grids preview
  // the real result rather than a nominal color.
  const backgroundSwatches = BACKGROUNDS.map((option) => ({
    id: option.id,
    label: option.label,
    color: resolveBackground(option.id, systemDark),
  }));
  const textSwatches = TEXT_COLORS.map((option) => ({
    id: option.id,
    label: option.label,
    color: resolveTextColor(option.id, theme.colors.background),
    fill: theme.colors.background,
  }));

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
    >
      <SettingsGroup
        header="Background"
        footer="System follows your phone's light/dark setting. Cards, separators, and the status bar follow whichever background you pick."
      >
        <SettingsSwatchRow
          options={backgroundSwatches}
          selected={appearance.background}
          onSelect={setBackground}
        />
      </SettingsGroup>

      <SettingsGroup
        header="Text color"
        footer="Shown on your current background. A color that would be unreadable there is lightened or darkened until it is."
      >
        <SettingsSwatchRow
          options={textSwatches}
          selected={appearance.textColor}
          onSelect={setTextColor}
        />
      </SettingsGroup>

      <SettingsGroup header="Text size">
        <SettingsStepperRow
          title="Size"
          value={`${appearance.fontSize}pt`}
          canDecrease={appearance.fontSize > MIN_FONT_SIZE}
          canIncrease={appearance.fontSize < MAX_FONT_SIZE}
          onDecrease={() => setFontSize(appearance.fontSize - FONT_SIZE_STEP)}
          onIncrease={() => setFontSize(appearance.fontSize + FONT_SIZE_STEP)}
        />
      </SettingsGroup>

      <View
        style={[
          styles.preview,
          {
            backgroundColor: theme.colors.background,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <Text
          style={{
            color: theme.colors.text,
            fontSize: theme.fontSize,
            lineHeight: theme.lineHeight,
          }}
        >
          {PREVIEW_TEXT}
        </Text>
      </View>

      <SettingsGroup footer="These settings are stored on this phone only — they are never synced to your other devices.">
        <SettingsActionRow title="Reset to Defaults" onPress={reset} />
      </SettingsGroup>
    </ScrollView>
  );
};

/**
 * Picking a transcription mode and — for AssemblyAI — proving the key works.
 *
 * The mode lives in the working folder's synced settings while the key lives on
 * the device, so "AssemblyAI is selected" and "this phone can reach AssemblyAI"
 * are two different facts. The screen states both, and the single key action
 * always ends by asking AssemblyAI, so the answer is never a guess.
 */
export const SettingsTranscriptionScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const store = useSettingsStore();
  const snapshot = store.snapshot;
  const profile = activeProfile(snapshot);

  const storedKey = snapshot?.app_config.assemblyai_api_key ?? "";
  const [assemblyKey, setAssemblyKey] = useState(storedKey);
  const [check, setCheck] = useState<KeyCheck>({ status: "idle" });
  const [manual, setManual] = useState<SetupNotice | null>(null);
  const [manualBusy, setManualBusy] = useState(false);

  // The snapshot loads asynchronously and changes when the working folder
  // switches; without this the field would keep showing whatever was there when
  // the screen mounted — usually nothing.
  useEffect(() => {
    setAssemblyKey(storedKey);
    setCheck({ status: "idle" });
  }, [storedKey]);

  const currentMode = profile ? effectiveTranscriptionMode(profile.settings) : null;
  const modeIsLegacyDerived = profile
    ? profile.settings.transcription_mode == null
    : false;
  const routedToAssembly = currentMode === "assemblyai";
  const notice = assemblySetupNotice({ routedToAssembly, storedKey, check });

  const verifyKey = () => {
    setCheck({ status: "checking" });
    void store
      .saveAndVerifyAssemblyAiKey(assemblyKey)
      .then(() => setCheck({ status: "verified" }))
      .catch((error: unknown) =>
        setCheck({ status: "failed", message: getErrorMessage(error) })
      );
  };

  const removeKey = () => {
    setCheck({ status: "idle" });
    void store
      .clearAssemblyAiKey()
      .then(() => setAssemblyKey(""))
      .catch(() => {});
  };

  const transcribePending = () => {
    setManualBusy(true);
    setManual(null);
    void store
      .transcribePendingRecordings()
      .then((queued) => setManual(queuedRecordingsNotice(queued)))
      .catch((error: unknown) =>
        setManual({ tone: "warning", text: getErrorMessage(error) })
      )
      .finally(() => setManualBusy(false));
  };

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
            : "The mode belongs to this working folder and syncs with your notes."
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
        footer="Stored on this phone only — never synced. Get one at assemblyai.com/app/api-keys."
      >
        <SettingsNoticeRow tone={notice.tone} text={notice.text} />
        <SettingsFieldRow
          value={assemblyKey}
          onChangeText={(next) => {
            setAssemblyKey(next);
            // A verdict belongs to the key that earned it.
            setCheck({ status: "idle" });
          }}
          placeholder={hasStoredKey(storedKey) ? maskApiKey(storedKey) : "API key"}
          secureTextEntry
          accessibilityLabel="AssemblyAI API key"
        />
        <SettingsActionRow
          title={
            check.status === "checking"
              ? "Checking…"
              : keyActionTitle(assemblyKey, storedKey)
          }
          disabled={isKeyActionDisabled(assemblyKey, storedKey, check)}
          onPress={verifyKey}
        />
        {hasStoredKey(storedKey) ? (
          <SettingsActionRow title="Remove Key" onPress={removeKey} />
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        header="Transcribe now"
        footer="Works in any mode: send whatever is still waiting to AssemblyAI once, without switching this folder to automatic uploads."
      >
        {manual ? <SettingsNoticeRow tone={manual.tone} text={manual.text} /> : null}
        <SettingsActionRow
          title={manualBusy ? "Sending…" : "Transcribe Pending Recordings"}
          disabled={manualBusy || !hasStoredKey(storedKey)}
          onPress={transcribePending}
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
  // Painted in the page background rather than the card surface: the sample
  // has to show the real editor colors, so only the hairline separates it.
  preview: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 28,
  },
});
