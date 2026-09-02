// Settings is a two-level menu: this file's default export lands on a list
// of sections, each of which pushes into its own dedicated screen (also
// exported from here) rather than showing everything in one long scroll.
// All three screens use the iOS inset-grouped list kit in ui/settings-list.

import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as FileSystem from "expo-file-system/legacy";
import { useState, useSyncExternalStore } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import {
  effectiveTranscriptionMode,
  type TranscriptionMode,
} from "@typenotes/shared/types";

import {
  backgroundLabel,
  BACKGROUNDS,
  FONT_FAMILIES,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  resolveBackground,
  resolveFontFamily,
  resolveTextColor,
  TEXT_COLORS,
} from "../lib/appearance";
import {
  copyWorkingFolderToFiles,
  exportArchiveToFiles,
} from "../lib/backup-export";
import { backupFolderName } from "../lib/backup-naming";
import {
  clearGestureAttempts,
  getGestureAttempts,
  outcomeOf,
  subscribeToGestureAttempts,
  summarizeGestureAttempts,
} from "../lib/gesture-trace";
import type { RootStackParamList } from "../navigation";
import { useAppearanceStore } from "../state/appearance-store";
import { useBackgroundOperationStore } from "../state/background-operation-store";
import { useDiagnosticsStore } from "../state/diagnostics-store";
import { activeProfile, useSettingsStore } from "../state/settings-store";
import { useTheme } from "../theme";
import {
  SettingsActionRow,
  SettingsColorRow,
  SettingsFieldRow,
  SettingsGroup,
  SettingsToggleRow,
  SettingsRow,
  SettingsStepperRow,
  SettingsSwatchRow,
} from "../ui/settings-list";
import { ColorWheelModal } from "../ui/color-wheel-modal";

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
const TILE_PURPLE = "#af52de";
const TILE_GRAY = "#8e8e93";

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
        <SettingsRow
          icon="color-palette-outline"
          iconColor={TILE_PURPLE}
          title="Appearance"
          value={backgroundLabel(appearance.background)}
          chevron
          onPress={() => navigation.navigate("SettingsAppearance")}
        />
        <SettingsRow
          icon="pulse-outline"
          iconColor={TILE_GRAY}
          title="Diagnostics"
          chevron
          onPress={() => navigation.navigate("SettingsDiagnostics")}
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
  const [backupBusy, setBackupBusy] = useState<"archive" | "folder" | null>(null);
  const [backupStatus, setBackupStatus] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const saveArchive = async () => {
    useBackgroundOperationStore.getState().begin();
    setBackupBusy("archive");
    setBackupStatus(null);
    let archivePath: string | null = null;
    try {
      const archive = await core.createProfilesBackupZip();
      archivePath = archive.archive_path;
      const result = await exportArchiveToFiles(
        archive.archive_path,
        archive.archive_name
      );
      setBackupStatus(
        result.cancelled
          ? { kind: "success", text: "Backup canceled — nothing was changed." }
          : {
              kind: "success",
              text: `ZIP saved: ${archive.file_count} files from ${archive.profile_count} working folder${archive.profile_count === 1 ? "" : "s"}.`,
            }
      );
    } catch (error) {
      setBackupStatus({ kind: "error", text: getErrorMessage(error) });
    } finally {
      if (archivePath) {
        const archiveUri = archivePath.startsWith("file://")
          ? archivePath
          : `file://${archivePath}`;
        await FileSystem.deleteAsync(archiveUri, { idempotent: true }).catch(() => {});
      }
      setBackupBusy(null);
      useBackgroundOperationStore.getState().end();
    }
  };

  const copyFolder = async () => {
    if (!profile) return;
    useBackgroundOperationStore.getState().begin();
    setBackupBusy("folder");
    setBackupStatus(null);
    try {
      const result = await copyWorkingFolderToFiles(
        profile.notes_root,
        backupFolderName(profile.name)
      );
      setBackupStatus(
        result.cancelled
          ? { kind: "success", text: "Backup canceled — nothing was changed." }
          : {
              kind: "success",
              text: `Folder copied: ${result.file_count ?? 0} files.`,
            }
      );
    } catch (error) {
      setBackupStatus({ kind: "error", text: getErrorMessage(error) });
    } finally {
      setBackupBusy(null);
      useBackgroundOperationStore.getState().end();
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
    >
      <SettingsGroup
        header="Working folders"
        footer="Each working folder is a directory of Markdown files with its own settings. On mobile it currently lives inside Type's private app container; use Backups below to put a safe copy in Files."
      >
        {snapshot?.profiles.map((p) => {
          const active = p.id === snapshot.active_profile_id;
          return (
            <SettingsRow
              key={p.id}
              title={p.name}
              subtitle="App storage"
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
          footer="Choosing a Files folder as the live working folder is not available yet. The backup copy below is independent and will not move or change your live notes."
        >
          <SettingsRow title="App storage" value="Default" />
        </SettingsGroup>
      ) : null}

      <SettingsGroup
        header="Backups"
        footer="Save a ZIP containing every working folder, or copy the active working folder as ordinary files. Both include hidden folder settings, recordings, attachments, and Git data. The live folder is never moved."
      >
        <SettingsActionRow
          title={backupBusy === "archive" ? "Preparing ZIP…" : "Save All as ZIP to Files…"}
          disabled={backupBusy !== null || store.demoMode}
          onPress={() => void saveArchive()}
        />
        <SettingsActionRow
          title={
            backupBusy === "folder"
              ? "Copying Folder…"
              : `Copy ${profile?.name ?? "Active Folder"} to Files…`
          }
          disabled={backupBusy !== null || !profile || store.demoMode}
          onPress={() => void copyFolder()}
        />
      </SettingsGroup>

      {backupStatus ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[
            styles.backupStatus,
            {
              color:
                backupStatus.kind === "error"
                  ? theme.colors.danger
                  : theme.colors.secondaryText,
            },
          ]}
        >
          {backupStatus.text}
        </Text>
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
 * the preview for the colors; the bordered sample below previews typography,
 * which only applies to the capture page and the note editor.
 */
export const SettingsAppearanceScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const systemDark = useColorScheme() === "dark";
  const appearance = useAppearanceStore((s) => s.appearance);
  const setBackground = useAppearanceStore((s) => s.setBackground);
  const setTextColor = useAppearanceStore((s) => s.setTextColor);
  const setCustomBackground = useAppearanceStore((s) => s.setCustomBackground);
  const setCustomTextColor = useAppearanceStore((s) => s.setCustomTextColor);
  const setAccentColor = useAppearanceStore((s) => s.setAccentColor);
  const setFontSize = useAppearanceStore((s) => s.setFontSize);
  const setFontFamily = useAppearanceStore((s) => s.setFontFamily);
  const reset = useAppearanceStore((s) => s.reset);
  const [colorTarget, setColorTarget] = useState<
    "background" | "text" | "accent" | null
  >(null);
  const platform =
    Platform.OS === "android" || Platform.OS === "web" ? Platform.OS : "ios";

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
  const pickerValue =
    colorTarget === "background"
      ? appearance.customBackground
      : colorTarget === "text"
        ? appearance.customTextColor
        : appearance.accentColor ?? theme.colors.accent;
  const pickerTitle =
    colorTarget === "background"
      ? "Background color"
      : colorTarget === "text"
        ? "Text color"
        : "Accent color";

  const saveCustomColor = (color: string) => {
    if (colorTarget === "background") {
      setCustomBackground(color);
    } else if (colorTarget === "text") {
      setCustomTextColor(color);
    } else if (colorTarget === "accent") {
      setAccentColor(color);
    }
  };

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
        <SettingsColorRow
          title="Custom color"
          color={appearance.customBackground}
          value={appearance.customBackground.toUpperCase()}
          checked={appearance.background === "custom"}
          onPress={() => setColorTarget("background")}
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
        <SettingsColorRow
          title="Custom color"
          color={appearance.customTextColor}
          value={appearance.customTextColor.toUpperCase()}
          checked={appearance.textColor === "custom"}
          onPress={() => setColorTarget("text")}
        />
      </SettingsGroup>

      <SettingsGroup
        header="Accent color"
        footer="Accent colors buttons, checkmarks, links, and active controls. Automatic picks a readable blue for the current background."
      >
        <SettingsRow
          title="Automatic"
          checked={appearance.accentColor === null}
          onPress={() => setAccentColor(null)}
        />
        <SettingsColorRow
          title="Custom color"
          color={appearance.accentColor ?? theme.colors.accent}
          value={(appearance.accentColor ?? theme.colors.accent).toUpperCase()}
          checked={appearance.accentColor !== null}
          onPress={() => setColorTarget("accent")}
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

      <SettingsGroup
        header="Font"
        footer="The font applies to the blank capture page and note editor."
      >
        {FONT_FAMILIES.map((option) => (
          <SettingsRow
            key={option.id}
            title={option.label}
            subtitle={option.description}
            titleFontFamily={resolveFontFamily(option.id, platform)}
            checked={appearance.fontFamily === option.id}
            onPress={() => setFontFamily(option.id)}
          />
        ))}
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
            fontFamily: theme.fontFamily,
          }}
        >
          {PREVIEW_TEXT}
        </Text>
      </View>

      <SettingsGroup footer="These settings are stored on this phone only — they are never synced to your other devices.">
        <SettingsActionRow title="Reset to Defaults" onPress={reset} />
      </SettingsGroup>

      <SettingsGroup
        header="Debug"
        footer="Temporary development output. Long-press the JSON to select and copy it."
      >
        <Text
          selectable
          style={[
            styles.debugJson,
            {
              color: theme.colors.text,
              fontFamily: "monospace",
            },
          ]}
        >
          {JSON.stringify(appearance, null, 2)}
        </Text>
      </SettingsGroup>

      <ColorWheelModal
        visible={colorTarget !== null}
        title={pickerTitle}
        value={pickerValue}
        onClose={() => setColorTarget(null)}
        onSave={saveCustomColor}
      />
    </ScrollView>
  );
};

/**
 * Development-facing readouts, all off by default and all device-local. These
 * are deliberately not on the Appearance screen: its "Reset to Defaults" must
 * not switch a diagnostic back on behind the user's back.
 */
/**
 * One line per recorded touch on the capture page.
 *
 * Reads the ring buffer directly through useSyncExternalStore rather than a
 * store: the trace is a debugging instrument with a one-session lifetime, and
 * nothing outside this screen should be able to subscribe to it.
 */
const GestureTraceList = () => {
  const theme = useTheme();
  const attempts = useSyncExternalStore(
    subscribeToGestureAttempts,
    getGestureAttempts
  );
  const summary = summarizeGestureAttempts(attempts);

  if (attempts.length === 0) {
    return (
      <Text style={[styles.traceEmpty, { color: theme.colors.secondaryText }]}>
        No touches recorded yet. Swipe on the capture page and come back.
      </Text>
    );
  }

  return (
    <View>
      <Text style={[styles.traceSummary, { color: theme.colors.text }]}>
        {summary.total} upward {summary.total === 1 ? "swipe" : "swipes"}:{" "}
        {summary.filed} filed, {summary.stolen} taken away
        {summary.stolen > 0
          ? ` (started at y=${summary.stolenStartY.join(", ")})`
          : ""}
      </Text>
      {attempts.map((attempt, index) => (
        <Text
          // Two touches can land in the same millisecond; the position in the
          // buffer is what actually identifies a row.
          key={`${attempt.at}-${index}`}
          style={[
            styles.traceRow,
            {
              color:
                outcomeOf(attempt) === "stolen"
                  ? theme.colors.danger
                  : theme.colors.secondaryText,
            },
          ]}
        >
          {`x=${Math.round(attempt.startX)} y=${Math.round(attempt.startY)}  `}
          {`dx=${Math.round(attempt.maxDx)} dy=${Math.round(attempt.maxDy)}  `}
          {`${attempt.durationMs}ms  → ${outcomeOf(attempt)}`}
        </Text>
      ))}
    </View>
  );
};

export const SettingsDiagnosticsScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const showCaptureSyncStatus = useDiagnosticsStore(
    (s) => s.diagnostics.showCaptureSyncStatus
  );
  const setShowCaptureSyncStatus = useDiagnosticsStore(
    (s) => s.setShowCaptureSyncStatus
  );
  const traceGestures = useDiagnosticsStore((s) => s.diagnostics.traceGestures);
  const setTraceGestures = useDiagnosticsStore((s) => s.setTraceGestures);

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
    >
      <SettingsGroup
        header="Capture page"
        footer="Shows the auto-sync state (Saved locally, Syncing…, Waiting for computer, Synced) in the top corner of the blank page. The same state is always on the Menu and Sync screens. Stored on this phone only — never synced."
      >
        <SettingsToggleRow
          title="Sync status"
          value={showCaptureSyncStatus}
          onValueChange={setShowCaptureSyncStatus}
        />
      </SettingsGroup>

      <SettingsGroup
        header="Gesture trace"
        footer="Records one line per touch on the capture page: where it started, how far it travelled, and what became of it. `stolen` means the finger clearly went up but something outside the app took the touch — the native back gesture, or the system's home-indicator swipe at the very bottom edge. Kept in memory only, cleared when the app restarts."
      >
        <SettingsToggleRow
          title="Record swipes"
          value={traceGestures}
          onValueChange={setTraceGestures}
        />
        {traceGestures ? (
          <SettingsActionRow title="Clear" onPress={clearGestureAttempts} />
        ) : null}
      </SettingsGroup>

      {traceGestures ? <GestureTraceList /> : null}
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
  backupStatus: { fontSize: 13, lineHeight: 18, marginHorizontal: 16, marginTop: -16, marginBottom: 28 },
  // Painted in the page background rather than the card surface: the sample
  // has to show the real editor colors, so only the hairline separates it.
  preview: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 28,
  },
  debugJson: {
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  traceEmpty: {
    fontSize: 13,
    lineHeight: 18,
    marginHorizontal: 16,
    marginTop: 4,
  },
  traceSummary: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
  },
  traceRow: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
    lineHeight: 16,
    marginHorizontal: 16,
  },
});
