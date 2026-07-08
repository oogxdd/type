// The floating dictation button (bottom-right of the capture page) — this
// replaced the old Record screen. Tap to start, tap again to stop; or press
// and hold to record only while held (release = stop & save, handy for quick
// 5–10s clips). Saving goes through the core (Feed note + audio file +
// transcription_status: pending), then queues transcription according to the
// working folder's transcription_mode:
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
import * as FileSystem from "expo-file-system/legacy";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import {
  effectiveTranscriptionMode,
  type TranscriptionMode,
} from "@typenotes/shared/types";

import { nativeTranscriptionProvider } from "../lib/native-transcription";
import { useNotesStore } from "../state/notes-store";
import { activeProfile, useSettingsStore } from "../state/settings-store";
import { useTheme } from "../theme";

// A press released after this long counts as "hold to record" and stops on
// release; a quicker press is a tap that leaves the recording running.
const HOLD_TO_RECORD_MS = 400;
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
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start is async (permission prompt, prepare) — a hold can end before it
  // finishes, so stopAndSave awaits the in-flight start before stopping.
  const startPromise = useRef<Promise<void> | null>(null);
  const pressInAt = useRef(0);
  const pressStartedRecording = useRef(false);

  const snapshot = useSettingsStore((s) => s.snapshot);
  const settings = activeProfile(snapshot)?.settings;
  const mode: TranscriptionMode = settings
    ? effectiveTranscriptionMode(settings)
    : "desktop";

  useEffect(() => {
    onRecordingChange?.(recorderState.isRecording);
  }, [recorderState.isRecording, onRecordingChange]);

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
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
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

      let detail = MODE_SAVED_DETAIL[mode];
      if (mode === "assemblyai") {
        try {
          await core.queueRecordingTranscriptions();
        } catch (queueError) {
          detail = `Saved, but queueing failed: ${getErrorMessage(queueError)}`;
        }
      } else if (mode === "native") {
        try {
          await core.queueProviderTranscriptions(nativeTranscriptionProvider);
        } catch (queueError) {
          detail = `Saved, but queueing failed: ${getErrorMessage(queueError)}`;
        }
      }
      showStatus({ kind: "success", text: detail });
      void useNotesStore.getState().refresh();
    } catch (err) {
      showStatus({ kind: "error", text: getErrorMessage(err) });
    } finally {
      startPromise.current = null;
      setBusy(false);
      // Leave the play-and-record session so playback routes normally again.
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(
        () => {}
      );
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

  // The handlers read recorder.isRecording (a live native property) instead
  // of recorderState, which only re-polls every ~500ms — a quick tap-then-
  // release would otherwise see stale state.
  const onPressIn = () => {
    if (busy) {
      return;
    }
    pressInAt.current = Date.now();
    if (recorder.isRecording || startPromise.current) {
      pressStartedRecording.current = false;
      return;
    }
    pressStartedRecording.current = true;
    setStatus(null);
    startPromise.current = start().catch((err) => {
      startPromise.current = null;
      pressStartedRecording.current = false;
      showStatus({ kind: "error", text: getErrorMessage(err) });
    });
  };

  const onPressOut = () => {
    // Only an actual recording can be stopped; if start() is still in flight
    // (e.g. the first-use permission prompt interrupted the hold), releasing
    // leaves the recording running once it starts — the next tap stops it.
    if (busy || !recorder.isRecording) {
      return;
    }
    const held = Date.now() - pressInAt.current;
    if (pressStartedRecording.current && held < HOLD_TO_RECORD_MS) {
      // Quick tap: recording keeps running until the next tap.
      return;
    }
    void stopAndSave();
  };

  const seconds = Math.floor((recorderState.durationMillis ?? 0) / 1000);
  const timer = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

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
      {/* Same neutral circle as the toolbar buttons; only the icon signals
          the recording state. */}
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
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
