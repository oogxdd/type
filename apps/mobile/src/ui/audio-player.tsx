// Inline audio player for a voice-recording note — the mobile counterpart to
// the desktop editor's <audio controls> element in RecordingNoteHeader.
// The core only exposes audio as a base64 payload, so we write it to a cache
// file once and hand expo-audio a file:// URI (same pattern the dictation
// button uses in reverse when it saves a fresh recording).

import { Ionicons } from "@expo/vector-icons";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";

import { useTheme } from "../theme";

const extensionForMime = (mimeType: string) => {
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("webm")) return "webm";
  return "audio";
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
};

export const RecordingAudioPlayer = ({ audioPath }: { audioPath: string }) => {
  const theme = useTheme();
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAudioUri(null);
    setError(null);
    core
      .readRecordingAudio(audioPath)
      .then(async (payload) => {
        const target = `${FileSystem.cacheDirectory}playback-${encodeURIComponent(
          audioPath
        )}.${extensionForMime(payload.mime_type)}`;
        await FileSystem.writeAsStringAsync(target, payload.audio_base64, {
          encoding: "base64",
        });
        if (!cancelled) {
          setAudioUri(target);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(getErrorMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [audioPath]);

  const player = useAudioPlayer(audioUri);
  const status = useAudioPlayerStatus(player);
  const ready = audioUri !== null && status.isLoaded;
  const duration = status.duration || 0;
  const currentTime = status.currentTime || 0;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  const toggle = () => {
    if (!ready) {
      return;
    }
    if (status.playing) {
      player.pause();
      return;
    }
    if (duration > 0 && currentTime >= duration) {
      void player.seekTo(0);
    }
    player.play();
  };

  if (error) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Text style={{ color: theme.colors.danger, fontSize: 12 }}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <Pressable
        onPress={toggle}
        disabled={!ready}
        hitSlop={8}
        style={({ pressed }) => [
          styles.playButton,
          {
            backgroundColor: theme.colors.accent,
            opacity: !ready ? 0.4 : pressed ? 0.7 : 1,
          },
        ]}
      >
        <Ionicons name={status.playing ? "pause" : "play"} size={16} color="#ffffff" />
      </Pressable>
      <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
        <View
          style={[
            styles.progressFill,
            { backgroundColor: theme.colors.accent, width: `${progress * 100}%` },
          ]}
        />
      </View>
      <Text style={[styles.time, { color: theme.colors.secondaryText }]}>
        {ready ? `${formatTime(currentTime)} / ${formatTime(duration)}` : "Loading…"}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginHorizontal: 16,
    marginTop: 12,
  },
  playButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 2 },
  time: { fontSize: 11, fontVariant: ["tabular-nums"] },
});
