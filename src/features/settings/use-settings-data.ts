import { useCallback } from "react";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { useGitSync } from "@/contexts/git-sync-context";
import { useRecordings } from "@/features/recording/hooks/recordings-context";

export function useSettingsData() {
  const { syncSettings } = useProfiles();
  const { gitStatus, gitSyncAction, gitSyncBusy } = useGitSync();
  const {
    recordingSupported,
    isRecordingAudio,
    isRecordingFinalizing,
    transcriptionQueueBusy,
    activeAudioPath,
  } = useRecordings();

  const isRecordingBusy = isRecordingFinalizing || transcriptionQueueBusy;

  const canPull =
    !gitSyncBusy &&
    Boolean(gitStatus?.repo_initialized) &&
    !gitStatus?.has_uncommitted_changes;
  const canPush = !gitSyncBusy && Boolean(gitStatus?.repo_initialized);
  const canConnect = !gitSyncBusy && syncSettings.gitRemoteUrl.trim().length > 0;
  // One-tap sync connects on demand, so it only needs a remote URL.
  const canSync = !gitSyncBusy && syncSettings.gitRemoteUrl.trim().length > 0;
  const canQueue = !isRecordingBusy && syncSettings.assemblyAiApiKey.trim().length > 0;

  const syncActionLabel =
    gitSyncAction === "connect"
      ? "Connecting..."
      : gitSyncAction === "pull"
        ? "Pulling..."
        : gitSyncAction === "push"
          ? "Pushing..."
          : gitSyncAction === "refresh"
            ? "Refreshing..."
            : "Idle";

  const recorderState = !recordingSupported
    ? "Unsupported"
    : isRecordingAudio
      ? "Recording"
      : isRecordingBusy
        ? "Saving"
        : "Idle";

  const playButtonText = useCallback(
    (audioPath: string) =>
      activeAudioPath && activeAudioPath === audioPath ? "Playing" : "Play",
    [activeAudioPath]
  );

  return {
    isRecordingBusy,
    canPull,
    canPush,
    canConnect,
    canSync,
    canQueue,
    syncActionLabel,
    recorderState,
    playButtonText,
  };
}
