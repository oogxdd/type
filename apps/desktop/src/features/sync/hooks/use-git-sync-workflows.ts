import { useCallback } from "react";

import * as api from "@/features/sync/api/git-api";
import { yieldToUi } from "@/shared/lib/notes";
import { getErrorMessage } from "@typenotes/shared/errors";
import type {
  GitCommitHistoryEntry,
  GitSyncAction,
  GitSyncStatus,
  ProfileSyncSettings,
} from "@typenotes/shared/types";

type UseGitSyncWorkflowsArgs = {
  gitStatus: GitSyncStatus | null;
  gitSyncAction: GitSyncAction;
  setGitStatus: (status: GitSyncStatus | null) => void;
  setGitSyncAction: (action: GitSyncAction) => void;
  setGitSyncError: (error: string | null) => void;
  setGitCommitHistory: (history: GitCommitHistoryEntry[]) => void;
  setGitHistoryBusy: (busy: boolean) => void;
  setGitHistoryError: (error: string | null) => void;
  syncSettings: ProfileSyncSettings;
  updateSyncSettings: (patch: Partial<ProfileSyncSettings>) => Promise<void>;
  onSuccessfulSync: (syncedAt: string) => void;
};

const needsGitReconnect = (
  status: GitSyncStatus | null,
  remoteUrl: string,
  branch?: string
) =>
  !status?.repo_initialized ||
  status.remote_url !== remoteUrl ||
  Boolean(branch && status.current_branch && status.current_branch !== branch);

export function useGitSyncWorkflows({
  gitStatus,
  gitSyncAction,
  setGitStatus,
  setGitSyncAction,
  setGitSyncError,
  setGitCommitHistory,
  setGitHistoryBusy,
  setGitHistoryError,
  syncSettings,
  updateSyncSettings,
  onSuccessfulSync,
}: UseGitSyncWorkflowsArgs) {
  const gitSyncBusy = gitSyncAction !== "idle";

  const refreshGitStatus = useCallback(async () => {
    setGitSyncAction("refresh");
    await yieldToUi();
    try {
      const status = await api.getGitStatus();
      setGitStatus(status);
      setGitSyncError(null);
    } catch (error) {
      setGitSyncError(getErrorMessage(error));
    } finally {
      setGitSyncAction("idle");
    }
  }, [setGitStatus, setGitSyncAction, setGitSyncError]);

  const refreshGitHistory = useCallback(
    async (limit = 40) => {
      setGitHistoryBusy(true);
      await yieldToUi();
      try {
        const history = await api.getGitHistory(limit);
        setGitCommitHistory(history);
        setGitHistoryError(null);
      } catch (error) {
        setGitHistoryError(getErrorMessage(error));
        setGitCommitHistory([]);
      } finally {
        setGitHistoryBusy(false);
      }
    },
    [setGitCommitHistory, setGitHistoryBusy, setGitHistoryError]
  );

  const connectGitRepo = useCallback(async () => {
    const remoteUrl = syncSettings.gitRemoteUrl.trim();
    const branch = syncSettings.gitBranch.trim();
    if (!remoteUrl) {
      setGitSyncError("Remote repository URL is required.");
      return;
    }
    setGitSyncAction("connect");
    await yieldToUi();
    try {
      const status = await api.connectGitRepo(
        remoteUrl,
        branch || undefined,
        syncSettings.gitUsername.trim() || undefined,
        syncSettings.gitPassword || undefined
      );
      setGitStatus(status);
      setGitSyncError(null);
      void refreshGitHistory();
    } catch (error) {
      setGitSyncError(getErrorMessage(error));
    } finally {
      setGitSyncAction("idle");
    }
  }, [
    refreshGitHistory,
    setGitStatus,
    setGitSyncAction,
    setGitSyncError,
    syncSettings,
  ]);

  const ensureConfiguredGitRemote = useCallback(
    async (status: GitSyncStatus | null) => {
      const remoteUrl = syncSettings.gitRemoteUrl.trim();
      const branch = syncSettings.gitBranch.trim() || undefined;
      const username = syncSettings.gitUsername.trim() || undefined;
      const password = syncSettings.gitPassword || undefined;

      if (!remoteUrl || !needsGitReconnect(status, remoteUrl, branch)) {
        return status;
      }

      const connectedStatus = await api.connectGitRepo(
        remoteUrl,
        branch,
        username,
        password
      );
      setGitStatus(connectedStatus);
      return connectedStatus;
    },
    [setGitStatus, syncSettings]
  );

  const gitPull = useCallback(
    async (opts?: { onAfterPull?: () => Promise<void> }) => {
      const branch = syncSettings.gitBranch.trim();
      setGitSyncAction("pull");
      await yieldToUi();
      try {
        await ensureConfiguredGitRemote(await api.getGitStatus());
        const status = await api.gitPull(
          branch || undefined,
          syncSettings.gitUsername.trim() || undefined,
          syncSettings.gitPassword || undefined
        );
        setGitStatus(status);
        setGitSyncError(null);
        const syncedAt = new Date().toISOString();
        updateSyncSettings({ lastSuccessfulSyncAt: syncedAt });
        onSuccessfulSync(syncedAt);
        void refreshGitHistory();
        if (opts?.onAfterPull) {
          await opts.onAfterPull();
        }
      } catch (error) {
        setGitSyncError(getErrorMessage(error));
      } finally {
        setGitSyncAction("idle");
      }
    },
    [
      refreshGitHistory,
      ensureConfiguredGitRemote,
      setGitStatus,
      setGitSyncAction,
      setGitSyncError,
      syncSettings,
      updateSyncSettings,
      onSuccessfulSync,
    ]
  );

  const gitPush = useCallback(async () => {
    const branch = syncSettings.gitBranch.trim();
    const commitMessage = syncSettings.gitCommitMessage.trim();
    setGitSyncAction("push");
    await yieldToUi();
    try {
      const statusBeforePush = await ensureConfiguredGitRemote(
        await api.getGitStatus()
      );
      if (!statusBeforePush) {
        setGitSyncError("Remote repository URL is required.");
        return;
      }
      setGitStatus(statusBeforePush);
      if (!statusBeforePush.push_required) {
        setGitSyncError(null);
        void refreshGitHistory();
        return;
      }
      const status = await api.gitPush(
        commitMessage || undefined,
        branch || undefined,
        syncSettings.gitUsername.trim() || undefined,
        syncSettings.gitPassword || undefined
      );
      setGitStatus(status);
      setGitSyncError(null);
      const syncedAt = new Date().toISOString();
      updateSyncSettings({ lastSuccessfulSyncAt: syncedAt });
      onSuccessfulSync(syncedAt);
      void refreshGitHistory();
    } catch (error) {
      setGitSyncError(getErrorMessage(error));
    } finally {
      setGitSyncAction("idle");
    }
  }, [
    refreshGitHistory,
    ensureConfiguredGitRemote,
    setGitStatus,
    setGitSyncAction,
    setGitSyncError,
    syncSettings,
    updateSyncSettings,
    onSuccessfulSync,
  ]);

  // One-tap sync: connect (if needed) -> push local work -> pull/merge remote
  // -> push the merged result. The sequence matches the existing manual
  // controls, but it absorbs the expected first-push rejection when another
  // device has already advanced the remote branch.
  const syncNow = useCallback(
    async (opts?: {
      remote?: string;
      branch?: string;
      onAfterPull?: () => Promise<void>;
    }) => {
      // An explicit remote from discovery wins over the stored setting.
      const remoteUrl = (opts?.remote ?? syncSettings.gitRemoteUrl).trim();
      if (!remoteUrl) {
        setGitSyncError("Remote repository URL is required.");
        return;
      }
      const branch = (opts?.branch ?? syncSettings.gitBranch).trim() || undefined;
      const username = syncSettings.gitUsername.trim() || undefined;
      const password = syncSettings.gitPassword || undefined;
      const message = syncSettings.gitCommitMessage.trim() || undefined;

      if (opts?.remote) {
        void updateSyncSettings({
          gitRemoteUrl: opts.remote,
          ...(opts.branch ? { gitBranch: opts.branch } : {}),
        });
      }

      setGitSyncAction("sync");
      await yieldToUi();
      try {
        let status = await api.getGitStatus().catch(() => gitStatus);
        if (needsGitReconnect(status, remoteUrl, branch)) {
          status = await api.connectGitRepo(remoteUrl, branch, username, password);
          setGitStatus(status);
        }

        try {
          const beforeFirstPush = await api.getGitStatus();
          if (beforeFirstPush.push_required) {
            status = await api.gitPush(message, branch, username, password);
            setGitStatus(status);
          }
        } catch {
          // A rejected first push is fine here: the pull below reconciles it.
        }

        const beforePull = await api.getGitStatus();
        setGitStatus(beforePull);
        if (!beforePull.has_uncommitted_changes) {
          status = await api.gitPull(branch, username, password);
          setGitStatus(status);
          if (opts?.onAfterPull) {
            await opts.onAfterPull();
          }
        }

        const beforeFinalPush = await api.getGitStatus();
        setGitStatus(beforeFinalPush);
        if (beforeFinalPush.push_required) {
          status = await api.gitPush(message, branch, username, password);
          setGitStatus(status);
        }

        setGitSyncError(null);
        const syncedAt = new Date().toISOString();
        updateSyncSettings({ lastSuccessfulSyncAt: syncedAt });
        onSuccessfulSync(syncedAt);
        void refreshGitHistory();
      } catch (error) {
        setGitSyncError(getErrorMessage(error));
      } finally {
        setGitSyncAction("idle");
      }
    },
    [
      gitStatus,
      refreshGitHistory,
      setGitStatus,
      setGitSyncAction,
      setGitSyncError,
      syncSettings,
      updateSyncSettings,
      onSuccessfulSync,
    ]
  );

  return {
    gitSyncBusy,
    refreshGitStatus,
    refreshGitHistory,
    connectGitRepo,
    gitPull,
    gitPush,
    syncNow,
  };
}
