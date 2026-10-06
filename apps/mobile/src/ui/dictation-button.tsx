// The floating dictation button (bottom-right of the capture page) — this
// replaced the old Record screen. Tap to start, tap again to stop. Long press
// reveals camera/gallery actions for handwriting
// photos. Saving goes through the core (Feed note + audio/image file +
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
  IOSOutputFormat,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import {
  effectiveTranscriptionMode,
  type TranscriptionMode,
} from "@typenotes/shared/types";

import { nativeTranscriptionProvider } from "../lib/native-transcription";
import {
  addRecordingStopListener,
  consumePendingRecordingStop,
  endRecordingActivity,
  startRecordingActivity,
  holdRecordingSave,
  repairRecordingWave,
} from "../lib/recording-activity";
import { rememberRecording, forgetRecording, pendingRecordings } from "../lib/recording-journal";
import { RecordingSession } from "../lib/recording-session";
import { elapsedSeconds, formatRecordingTimer } from "../lib/recording-timer";
import { useNotesStore } from "../state/notes-store";
import { useRecordingSessionStore } from "../state/recording-session-store";
import { activeProfile, useSettingsStore } from "../state/settings-store";
import { useSyncStore } from "../state/sync-store";
import { useTheme } from "../theme";

// PCM WAV needs no AAC container finalization to recover persisted samples.
// 24 kHz mono is suitable for speech (~173 MB/hour); Android keeps AAC.
const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: "document" as const,
  ...(Platform.OS === "ios" ? {
    extension: ".wav", sampleRate: 24000, numberOfChannels: 1,
    ios: { ...RecordingPresets.HIGH_QUALITY.ios, outputFormat: IOSOutputFormat.LINEARPCM },
  } : {}),
};

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
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<PillStatus | null>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const permissionRequest = useRef<Promise<void> | null>(null);
  const stopAfterPermission = useRef(false);
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
    onRecordingChange?.(isRecording);
  }, [isRecording, onRecordingChange]);

  // Tick the wall clock while recording. A 500ms cadence keeps the seconds
  // readout crisp; the AppState 'active' listener forces an immediate recompute
  // the moment the app returns to the foreground, so the timer never shows a
  // stale value after the screen slept.
  useEffect(() => {
    if (!isRecording) {
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
  }, [isRecording]);

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

  const latest = useRef({ mode, snapshot });
  latest.current = { mode, snapshot };
  const nativeRecordingObserved = useRef(false);
  const sessionRef = useRef<RecordingSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = new RecordingSession({
      prepare: async () => {
        // Background warm-up never prompts. An explicit tap can request permission.
        const permission = await AudioModule.getRecordingPermissionsAsync();
        if (!permission.granted) {
          await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
          throw new Error("Microphone permission required.");
        }
        await setAudioModeAsync({
          allowsRecording: true, playsInSilentMode: true,
          shouldPlayInBackground: true, allowsBackgroundRecording: true,
        });
        // Passing options creates a new output file for each recording.
        await recorder.prepareToRecordAsync(RECORDING_OPTIONS);
      },
      makePending: () => {
        const profile = activeProfile(latest.current.snapshot);
        if (!profile || !recorder.uri) throw new Error("No working folder or recording file.");
        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          uri: recorder.uri, profileId: profile.id, notesRoot: profile.notes_root,
          mimeType: Platform.OS === "ios" ? "audio/wav" : Platform.OS === "web" ? "audio/webm" : "audio/mp4",
          startedAt: Date.now(),
        };
      },
      remember: rememberRecording,
      record: () => {
        recorder.record();
        if (!recorder.isRecording) throw new Error("The recorder could not start. Try again.");
      },
      pause: () => { if (recorder.isRecording) recorder.pause(); },
      stop: () => recorder.stop(),
      hold: () => {
        const store = useRecordingSessionStore.getState();
        const releaseTime = holdRecordingSave(`${Date.now()}-${Math.random()}`);
        store.begin();
        return () => { releaseTime(); store.end(); };
      },
      changed: (startedAt) => {
        nativeRecordingObserved.current = false;
        recordingStartedAt.current = startedAt;
        setIsRecording(startedAt !== null);
        setNowMs(Date.now());
        if (startedAt === null) endRecordingActivity();
        else startRecordingActivity(startedAt);
      },
      save: async (clip) => {
        if (clip.mimeType === "audio/wav") await repairRecordingWave(clip.uri);
        const saved = await core.saveAudioRecordingFromFile(decodeURI(clip.uri.replace(/^file:\/\//, "")), {
          mime_type: clip.mimeType,
        });
        return saved.note_path;
      },
      forget: forgetRecording,
      saved: (clip, interrupted) => {
        useSyncStore.getState().scheduleAutoSync("audio saved");
        const currentMode = latest.current.mode;
        const queue = currentMode === "assemblyai" ? () => core.queueRecordingTranscriptions()
          : currentMode === "native" ? () => core.queueProviderTranscriptions(nativeTranscriptionProvider) : null;
        if (queue) void queue().catch((error) => showStatus({ kind: "error", text: `Saved, but queueing failed: ${getErrorMessage(error)}` }));
        const detail = MODE_SAVED_DETAIL[currentMode];
        showStatus({ kind: "success", text: interrupted ? `Recovered recording. ${detail}` : detail });
        void useNotesStore.getState().noteFiled(clip.notePath!).catch(() => {});
      },
      error: (error) => showStatus({ kind: "error", text: `${getErrorMessage(error)} Audio retained; tap the microphone to retry saving.` }),
    });
  }
  const session = sessionRef.current;

  useEffect(() => {
    void session.warm().catch(() => {});
    const profile = activeProfile(snapshot);
    if (profile) {
      try {
        for (const clip of pendingRecordings(profile.id, profile.notes_root)) void session.import(clip);
      } catch (error) { showStatus({ kind: "error", text: getErrorMessage(error) }); }
    }
    return () => session.dispose();
    // Home is scoped to its workspace and remains mounted during backgrounding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

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
              base64: false,
              quality: 1,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              base64: false,
              quality: 1,
              allowsMultipleSelection: false,
            });
      if (result.canceled) {
        return;
      }
      const asset = result.assets[0];
      const saved = await core.saveHandwritingAttachmentFromFile(decodeURI(asset.uri.replace(/^file:\/\//, "")), {
        mime_type: asset.mimeType ?? "image/jpeg",
        file_name: asset.fileName ?? undefined,
      });
      useSyncStore.getState().scheduleAutoSync("attachment saved");
      showStatus({ kind: "success", text: "Saved — your desktop will recognize it" });
      void useNotesStore.getState().noteFiled(saved.note_path).catch(() => {});
    } catch (err) {
      showStatus({ kind: "error", text: getErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  // Native interruptions and Lock Screen stops join the same stop operation.
  useEffect(() => {
    if (recorderState.isRecording) nativeRecordingObserved.current = true;
    else if (nativeRecordingObserved.current && session.recording) {
      nativeRecordingObserved.current = false;
      void session.stop(true);
    }
  }, [recorderState.isRecording, session]);

  useEffect(() => {
    const stop = () => { if (session.recording) void session.stop(); };
    const unsubscribe = addRecordingStopListener(stop);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        if (consumePendingRecordingStop()) stop();
        else if (!session.recording) void session.warm().catch(() => {});
      }
    });
    return () => { unsubscribe(); subscription.remove(); };
  }, [session]);

  const onPress = () => {
    if (suppressNextPress.current) { suppressNextPress.current = false; return; }
    if (busy) return;
    if (permissionRequest.current) { stopAfterPermission.current = true; return; }
    if (session.recording) { void session.stop(); return; }
    if (session.retry()) return;
    setAttachmentMenuOpen(false);
    setStatus(null);
    // With permission granted, the warm recorder starts synchronously on tap.
    // The first ever recording necessarily awaits the system permission prompt.
    if (session.ready) { void session.start(); return; }
    stopAfterPermission.current = false;
    permissionRequest.current = AudioModule.getRecordingPermissionsAsync().then(async (permission) => {
      if (!permission.granted) {
        const requested = await AudioModule.requestRecordingPermissionsAsync();
        if (!requested.granted) {
          showStatus({ kind: "error", text: "Microphone permission denied — enable it in system settings." });
          return;
        }
      }
      await session.start();
      if (stopAfterPermission.current) await session.stop();
    }).catch((error) => showStatus({ kind: "error", text: getErrorMessage(error) }))
      .finally(() => { permissionRequest.current = null; });
  };

  const onLongPress = () => {
    if (busy || session.recording) {
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
      {isRecording ? (
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
      {attachmentMenuOpen && !isRecording ? (
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
          name={isRecording ? "stop" : "mic-outline"}
          size={25}
          color={isRecording ? theme.colors.danger : theme.colors.text}
          style={{ opacity: isRecording ? 1 : 0.8 }}
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
