import {
  selectSyncSettings,
  useProfilesStore,
} from "@/state/profiles-store";
import { selectGitSyncBusy, useGitSyncStore } from "@/state/git-sync-store";
import { recordingSupported, useRecordingsStore } from "@/state/recordings-store";

export function useSettingsData() {
  const syncSettings = useProfilesStore(selectSyncSettings);
  const gitStatus = useGitSyncStore((state) => state.status);
  const gitSyncAction = useGitSyncStore((state) => state.action);
  const gitSyncBusy = useGitSyncStore(selectGitSyncBusy);
  const isRecordingAudio = useRecordingsStore((state) => state.isRecording);
  const isRecordingFinalizing = useRecordingsStore((state) => state.isFinalizing);
  const transcriptionQueueBusy = useRecordingsStore((state) => state.queueBusy);

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

  return {
    isRecordingBusy,
    canPull,
    canPush,
    canConnect,
    canSync,
    canQueue,
    syncActionLabel,
    recorderState,
  };
}
