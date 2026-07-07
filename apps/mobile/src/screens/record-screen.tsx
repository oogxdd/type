// Voice capture. Records with expo-audio, saves through the core (which
// creates a Feed note with transcription_status: pending), then queues
// transcription according to the working folder's transcription_mode:
//
//   assemblyai → cloud queue now, on this device
//   native     → on-device speech recognition via the expo-speech-recognition
//                provider (lib/native-transcription), run by the core's queue
//   desktop    → stays pending; a synced desktop picks it up (local Whisper)
//   off        → stays pending until triggered manually

import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import {
  effectiveTranscriptionMode,
  type TranscriptionMode,
} from "@typenotes/shared/types";

import { nativeTranscriptionProvider } from "../lib/native-transcription";
import type { RootStackParamList } from "../navigation";
import { useNotesStore } from "../state/notes-store";
import { activeProfile, useSettingsStore } from "../state/settings-store";
import { useTheme } from "../theme";
import { Button, InlineNote } from "../ui/controls";

const MODE_EXPLANATION: Record<TranscriptionMode, string> = {
  assemblyai: "Will transcribe now via AssemblyAI.",
  native: "Will transcribe on this device with the system speech recognizer.",
  desktop: "Will stay pending until your desktop syncs and transcribes it.",
  off: "Automatic transcription is off — the recording stays pending.",
};

type SaveOutcome = {
  notePath: string;
  detail: string;
};

export const RecordScreen = () => {
  const theme = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const [permitted, setPermitted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const snapshot = useSettingsStore((s) => s.snapshot);
  const settings = activeProfile(snapshot)?.settings;
  const mode: TranscriptionMode = settings
    ? effectiveTranscriptionMode(settings)
    : "desktop";

  useEffect(() => {
    void (async () => {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      setPermitted(permission.granted);
      if (permission.granted) {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      }
    })();
  }, []);

  const start = async () => {
    setError(null);
    setOutcome(null);
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const stopAndSave = async () => {
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        throw new Error("Recorder produced no file.");
      }
      const audioBase64 = await FileSystem.readAsStringAsync(uri, {
        encoding: "base64",
      });
      const saved = await core.saveAudioRecording({
        audio_base64: audioBase64,
        mime_type: "audio/mp4",
      });

      let detail = MODE_EXPLANATION[mode];
      if (mode === "assemblyai") {
        try {
          const queued = await core.queueRecordingTranscriptions();
          detail = `Queued for AssemblyAI (${queued.queued} queued, ${queued.in_flight} in flight).`;
        } catch (queueError) {
          detail = `Saved, but queueing failed: ${getErrorMessage(queueError)}`;
        }
      } else if (mode === "native") {
        try {
          const queued = await core.queueProviderTranscriptions(
            nativeTranscriptionProvider
          );
          detail = `Transcribing on this device (${queued.queued} queued, ${queued.in_flight} in flight).`;
        } catch (queueError) {
          detail = `Saved, but queueing failed: ${getErrorMessage(queueError)}`;
        }
      }
      setOutcome({ notePath: saved.note_path, detail });
      void useNotesStore.getState().refresh();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const recording = recorderState.isRecording;
  const seconds = Math.floor((recorderState.durationMillis ?? 0) / 1000);

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
    >
      {permitted === false ? (
        <Text style={{ color: theme.colors.danger }}>
          Microphone permission was denied. Enable it in system settings.
        </Text>
      ) : (
        <>
          <View style={styles.meter}>
            <Text style={[styles.timer, { color: theme.colors.text }]}>
              {recording
                ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
                : "Ready"}
            </Text>
            <InlineNote>{MODE_EXPLANATION[mode]}</InlineNote>
          </View>

          {recording ? (
            <Button title="Stop & save" kind="danger" onPress={() => void stopAndSave()} disabled={busy} />
          ) : (
            <Button title="Start recording" onPress={() => void start()} disabled={busy || permitted === null} />
          )}

          {outcome ? (
            <View style={styles.outcome}>
              <Text style={{ color: theme.colors.success, fontWeight: "600" }}>
                Recording saved.
              </Text>
              <InlineNote>{outcome.detail}</InlineNote>
              <Button
                title="Open note"
                kind="secondary"
                onPress={() =>
                  navigation.replace("Editor", {
                    path: outcome.notePath,
                    title: "Voice recording",
                  })
                }
              />
            </View>
          ) : null}
          {error ? <Text style={{ color: theme.colors.danger }}>{error}</Text> : null}
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  meter: { alignItems: "center", gap: 8, paddingVertical: 24 },
  timer: { fontSize: 44, fontVariant: ["tabular-nums"], fontWeight: "300" },
  outcome: { gap: 10, paddingTop: 8 },
});
