// The floating dictation button (bottom-right of the capture page) — this
// replaced the old Record screen. Tap to start, tap again to stop. Long press
// reveals camera/gallery actions for handwriting photos, plus an action for
// importing an audio file that already exists on the phone (a Voice Memo saved
// to Files, say — sharing one straight into Type is handled in App.tsx and
// takes the same path). Saving goes through the core (Feed note + audio/image
// file + transcription_status: pending), then queues transcription according
// to the working folder's transcription_mode:
//
//   assemblyai → cloud queue now, on this device
//   native     → on-device speech recognition via the expo-speech-recognition
//                provider (lib/native-transcription), run by the core's queue
//   desktop    → stays pending; a synced desktop picks it up (local Whisper)
//   off        → stays pending until triggered manually

import { Ionicons } from "@expo/vector-icons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import {
  effectiveTranscriptionMode,
  type TranscriptionMode,
} from "@typenotes/shared/types";

import { runAudioImport } from "../lib/audio-intake";
import {
  addRecordingStopListener,
  consumePendingRecordingStop,
  endRecordingActivity,
  startRecordingActivity,
} from "../lib/recording-activity";
import { elapsedSeconds, formatRecordingTimer } from "../lib/recording-timer";
import { startTranscription } from "../lib/transcription-queue";
import { useNotesStore } from "../state/notes-store";
import { activeProfile, useSettingsStore } from "../state/settings-store";
import { useTheme } from "../theme";

const STATUS_VISIBLE_MS = 4000;

const MODE_SAVED_DETAIL: Record<TranscriptionMode, string> = {
  assemblyai: "Saved — transcribing via AssemblyAI",
  native: "Saved — transcribing on this device",
  desktop: "Saved — your desktop will transcribe it",
  off: "Saved",
};

type PillStatus = { kind: "success" | "error"; text: string };

export const DictationButton = ({
  onRecordingChange,
}: {
  onRecordingChange?: (recording: boolean) => void;
}) => {
  const theme = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<PillStatus | null>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start is async (permission prompt, prepare) — a hold can end before it
  // finishes, so stopAndSave awaits the in-flight start before stopping.
  const startPromise = useRef<Promise<void> | null>(null);
  const suppressNextPress = useRef(false);

  // Wall-clock anchor for the timer. expo-audio's polled `durationMillis`
  // freezes while the app is suspended (screen lock) and does not reflect the
  // time that passed, so the visible timer is driven from Date.now() instead.
  const recordingStartedAt = useRef<number | null>(null);
  // A ticking "now" that re-renders the timer while recording; recomputed
  // against the anchor so it reads correctly the instant the app resumes.
  const [nowMs, setNowMs] = useState(0);

  const snapshot = useSettingsStore((s) => s.snapshot);
  const settings = activeProfile(snapshot)?.settings;
  const mode: TranscriptionMode = settings
    ? effectiveTranscriptionMode(settings)
    : "desktop";

  useEffect(() => {
    onRecordingChange?.(recorderState.isRecording);
  }, [recorderState.isRecording, onRecordingChange]);

  // Tick the wall clock while recording. A 500ms cadence keeps the seconds
  // readout crisp; the AppState 'active' listener forces an immediate recompute
  // the moment the app returns to the foreground, so the timer never shows a
  // stale value after the screen slept.
  useEffect(() => {
    if (!recorderState.isRecording) {
      return;
    }
    if (recordingStartedAt.current == null) {
      // Defensive: if start() somehow did not anchor (e.g. an externally
      // resumed session), derive it from the recorder's own captured duration.
      recordingStartedAt.current = Date.now() - (recorderState.durationMillis ?? 0);
    }
    const tick = () => setNowMs(Date.now());
    tick();
    const interval = setInterval(tick, 500);
    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        tick();
      }
    });
    return () => {
      clearInterval(interval);
      appStateSub.remove();
    };
    // Only (re)arm on the recording flag — durationMillis is read once for the
    // defensive anchor above and must not thrash the interval on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderState.isRecording]);

  const showStatus = (next: PillStatus) => {
    if (statusTimer.current) {
      clearTimeout(statusTimer.current);
    }
    setStatus(next);
    statusTimer.current = setTimeout(() => setStatus(null), STATUS_VISIBLE_MS);
  };
  useEffect(
    () => () => {
      if (statusTimer.current) {
        clearTimeout(statusTimer.current);
      }
    },
    []
  );

  const start = async () => {
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      throw new Error("Microphone permission denied — enable it in system settings.");
    }
    // shouldPlayInBackground keeps the audio session — and therefore the native
    // recorder — alive when the screen locks, paired with the `audio`
    // UIBackgroundMode already declared in Info.plist. Without it iOS tears the
    // session down on background and the clip is silently truncated at lock time
    // (which is what made the timer appear frozen: there was nothing to catch
    // up to on wake).
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    });
    await recorder.prepareToRecordAsync();
    recorder.record();
    recordingStartedAt.current = Date.now();
    setNowMs(Date.now());
    // Mirror the session onto the Lock Screen / Dynamic Island so it stays
    // visible (and stoppable) while the phone is asleep. No-op off iOS.
    startRecordingActivity(recordingStartedAt.current);
  };

  const stopAndSave = async () => {
    setBusy(true);
    try {
      await startPromise.current;
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        throw new Error("Recorder produced no file.");
      }
      const audioBase64 = await FileSystem.readAsStringAsync(uri, {
        encoding: "base64",
      });
      await core.saveAudioRecording({
        audio_base64: audioBase64,
        mime_type: "audio/mp4",
      });

      const queueError = await startTranscription(mode);
      showStatus({
        kind: "success",
        text: queueError
          ? `Saved, but queueing failed: ${queueError}`
          : MODE_SAVED_DETAIL[mode],
      });
      void useNotesStore.getState().refresh();
    } catch (err) {
      showStatus({ kind: "error", text: getErrorMessage(err) });
    } finally {
      startPromise.current = null;
      recordingStartedAt.current = null;
      endRecordingActivity();
      setBusy(false);
      // Leave the play-and-record session and drop the background hold so
      // playback routes normally again.
      void setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      }).catch(() => {});
    }
  };

  const choosePhoto = async (source: "camera" | "library") => {
    setAttachmentMenuOpen(false);
    setBusy(true);
    try {
      const permission =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        throw new Error(
          source === "camera"
            ? "Camera permission denied — enable it in system settings."
            : "Photo library permission denied — enable it in system settings."
        );
      }

      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ["images"],
              base64: true,
              quality: 1,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              base64: true,
              quality: 1,
              allowsMultipleSelection: false,
            });
      if (result.canceled) {
        return;
      }
      const asset = result.assets[0];
      const imageBase64 =
        asset.base64 ??
        (await FileSystem.readAsStringAsync(asset.uri, { encoding: "base64" }));
      await core.saveHandwritingAttachment({
        image_base64: imageBase64,
        mime_type: asset.mimeType ?? "image/jpeg",
        file_name: asset.fileName ?? undefined,
      });
      showStatus({ kind: "success", text: "Saved — your desktop will recognize it" });
      void useNotesStore.getState().refresh();
    } catch (err) {
      showStatus({ kind: "error", text: getErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  // Import audio that already exists on the phone — a voice memo exported to
  // Files, a clip someone sent. Multi-select: the core imports them as one
  // background run, one note per file.
  const chooseAudioFiles = async () => {
    setAttachmentMenuOpen(false);
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "audio/*",
        multiple: true,
        // Without this the picker can hand back a URL we lose access to as
        // soon as it closes; the copy in the cache is ours to read and delete.
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return;
      }
      const { imported, message } = await runAudioImport(
        result.assets.map((asset) => ({
          uri: asset.uri,
          name: asset.name,
          discardAfterImport: true,
        }))
      );
      showStatus({ kind: imported > 0 ? "success" : "error", text: message });
    } catch (err) {
      showStatus({ kind: "error", text: getErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  // Keep the latest stopAndSave reachable from the unmount effect below.
  const stopAndSaveRef = useRef(stopAndSave);
  stopAndSaveRef.current = stopAndSave;
  const recordingRef = useRef(false);
  recordingRef.current = recorderState.isRecording;

  // Best effort: navigating away (the capture page pops) while recording
  // stops and saves the clip instead of silently dropping it.
  useEffect(
    () => () => {
      if (recordingRef.current) {
        void stopAndSaveRef.current().catch(() => {});
      }
    },
    []
  );

  // Stopping from the Lock Screen. The Live Activity's Stop button runs a
  // LiveActivityIntent inside this process, which the native module forwards
  // here — save the clip exactly as an in-app stop would.
  useEffect(() => {
    const stopFromLockScreen = () => {
      if (recorder.isRecording || startPromise.current) {
        void stopAndSaveRef.current().catch(() => {});
      }
    };
    const unsubscribe = addRecordingStopListener(stopFromLockScreen);
    // If the app was suspended when Stop was tapped, the live event never
    // arrived; honor the durable flag the intent left as soon as we're active.
    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "active" && consumePendingRecordingStop()) {
        stopFromLockScreen();
      }
    });
    return () => {
      unsubscribe();
      appStateSub.remove();
    };
  }, [recorder]);

  // Read recorder.isRecording (a live native property) instead of the polled
  // recorderState so quick start/stop taps cannot observe stale state.
  const onPress = () => {
    if (suppressNextPress.current) {
      suppressNextPress.current = false;
      return;
    }
    if (busy) {
      return;
    }
    if (recorder.isRecording || startPromise.current) {
      if (recorder.isRecording) {
        void stopAndSave();
      }
      return;
    }
    setAttachmentMenuOpen(false);
    setStatus(null);
    startPromise.current = start().catch((err) => {
      startPromise.current = null;
      showStatus({ kind: "error", text: getErrorMessage(err) });
    });
  };

  const onLongPress = () => {
    if (busy || recorder.isRecording || startPromise.current) {
      return;
    }
    suppressNextPress.current = true;
    setStatus(null);
    setAttachmentMenuOpen((open) => !open);
  };

  const startedAt = recordingStartedAt.current;
  const timer = formatRecordingTimer(
    startedAt != null ? elapsedSeconds(startedAt, nowMs) : 0
  );

  return (
    <View style={styles.root} pointerEvents="box-none">
      {recorderState.isRecording ? (
        <View style={[styles.pill, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <View style={[styles.recordingDot, { backgroundColor: theme.colors.danger }]} />
          <Text style={[styles.pillText, { color: theme.colors.text }]}>{timer}</Text>
        </View>
      ) : status ? (
        <View style={[styles.pill, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text
            style={[
              styles.pillText,
              { color: status.kind === "error" ? theme.colors.danger : theme.colors.secondaryText },
            ]}
            numberOfLines={2}
          >
            {status.text}
          </Text>
        </View>
      ) : null}
      {attachmentMenuOpen && !recorderState.isRecording ? (
        <View style={styles.attachmentActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take handwriting photo"
            onPress={() => void choosePhoto("camera")}
            disabled={busy}
            style={({ pressed }) => [
              styles.attachmentAction,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Ionicons name="camera-outline" size={22} color={theme.colors.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose handwriting photo"
            onPress={() => void choosePhoto("library")}
            disabled={busy}
            style={({ pressed }) => [
              styles.attachmentAction,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Ionicons name="images-outline" size={22} color={theme.colors.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Import audio file"
            onPress={() => void chooseAudioFiles()}
            disabled={busy}
            style={({ pressed }) => [
              styles.attachmentAction,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Ionicons name="musical-notes-outline" size={22} color={theme.colors.text} />
          </Pressable>
        </View>
      ) : null}
      {/* Same neutral circle as the toolbar buttons; only the icon signals
          the recording state. */}
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={400}
        disabled={busy}
        hitSlop={10}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            opacity: busy ? 0.5 : pressed ? 0.6 : 1,
            transform: [{ scale: pressed ? 0.94 : 1 }],
          },
        ]}
      >
        <Ionicons
          name={recorderState.isRecording ? "stop" : "mic-outline"}
          size={25}
          color={recorderState.isRecording ? theme.colors.danger : theme.colors.text}
          style={{ opacity: recorderState.isRecording ? 1 : 0.8 }}
        />
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { alignItems: "flex-end", gap: 10 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 260,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillText: { fontSize: 13, fontVariant: ["tabular-nums"] },
  recordingDot: { width: 8, height: 8, borderRadius: 4 },
  attachmentActions: { flexDirection: "row", gap: 10 },
  attachmentAction: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  // Slightly larger than the 38px toolbar circles — it's the primary action
  // on the capture page. Keep in sync with the menu's preview replica
  // (menu-screen.tsx previewMic).
  fab: {
    width: 64,
    height: 64,
    borderRadius: 100,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
