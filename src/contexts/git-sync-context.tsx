import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import * as api from "../data/git-api";
import type {
  GitCommitHistoryEntry,
  GitSyncAction,
  GitSyncStatus,
} from "../types";
import { yieldToUi } from "../utils/notes";
import { useProfiles } from "./profiles-context";
import { useLayoutMode } from "@/mobile/use-layout-mode";

type GitSyncContextValue = {
  gitStatus: GitSyncStatus | null;
  gitSyncAction: GitSyncAction;
  gitSyncError: string | null;
  gitSyncBusy: boolean;
  gitCommitHistory: GitCommitHistoryEntry[];
  gitHistoryBusy: boolean;
  gitHistoryError: string | null;
  refreshGitStatus: () => Promise<void>;
  refreshGitHistory: (limit?: number) => Promise<void>;
  connectGitRepo: () => Promise<void>;
  gitPull: (opts?: { onAfterPull?: () => Promise<void> }) => Promise<void>;
  gitPush: () => Promise<void>;
  syncNow: (opts?: {
    remote?: string;
    branch?: string;
    onAfterPull?: () => Promise<void>;
  }) => Promise<void>;
  setGitStatus: (status: GitSyncStatus | null) => void;
  setGitSyncError: (error: string | null) => void;
};

const GitSyncContext = createContext<GitSyncContextValue | null>(null);

export function GitSyncProvider({ children }: { children: ReactNode }) {
  const { activeProfileId, syncSettings, updateSyncSettings } = useProfiles();
  const layoutMode = useLayoutMode();
  const [gitStatus, setGitStatus] = useState<GitSyncStatus | null>(null);
  const [gitSyncAction, setGitSyncAction] = useState<GitSyncAction>("idle");
  const [gitSyncError, setGitSyncError] = useState<string | null>(null);
  const [gitCommitHistory, setGitCommitHistory] = useState<GitCommitHistoryEntry[]>([]);
  const [gitHistoryBusy, setGitHistoryBusy] = useState(false);
  const [gitHistoryError, setGitHistoryError] = useState<string | null>(null);

  const gitSyncBusy = gitSyncAction !== "idle";

  const refreshGitStatus = useCallback(async () => {
    setGitSyncAction("refresh");
    await yieldToUi();
    try {
      const status = await api.getGitStatus();
      setGitStatus(status);
      setGitSyncError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitSyncError(message);
    } finally {
      setGitSyncAction("idle");
    }
  }, []);

  const refreshGitHistory = useCallback(async (limit = 40) => {
    setGitHistoryBusy(true);
    await yieldToUi();
    try {
      const history = await api.getGitHistory(limit);
      setGitCommitHistory(history);
      setGitHistoryError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitHistoryError(message);
      setGitCommitHistory([]);
    } finally {
      setGitHistoryBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!activeProfileId) {
      setGitStatus(null);
      setGitSyncError(null);
      setGitCommitHistory([]);
      setGitHistoryError(null);
      return;
    }
    if (layoutMode === "phone") {
      return;
    }
    void refreshGitStatus();
    void refreshGitHistory();
  }, [activeProfileId, layoutMode, refreshGitHistory, refreshGitStatus]);

  useEffect(() => {
    if (!activeProfileId || !gitStatus?.repo_initialized) {
      return;
    }
    const patch: Partial<typeof syncSettings> = {};
    if (!syncSettings.gitRemoteUrl.trim() && gitStatus.remote_url) {
      patch.gitRemoteUrl = gitStatus.remote_url;
    }
    if (!syncSettings.gitBranch.trim() && gitStatus.current_branch) {
      patch.gitBranch = gitStatus.current_branch;
    }
    if (Object.keys(patch).length > 0) {
      updateSyncSettings(patch);
    }
  }, [
    activeProfileId,
    gitStatus,
    syncSettings.gitBranch,
    syncSettings.gitRemoteUrl,
    updateSyncSettings,
  ]);

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
      const message = error instanceof Error ? error.message : String(error);
      setGitSyncError(message);
    } finally {
      setGitSyncAction("idle");
    }
  }, [refreshGitHistory, syncSettings]);

  const gitPull = useCallback(
    async (opts?: { onAfterPull?: () => Promise<void> }) => {
      const branch = syncSettings.gitBranch.trim();
      setGitSyncAction("pull");
      await yieldToUi();
      try {
        const status = await api.gitPull(
          branch || undefined,
          syncSettings.gitUsername.trim() || undefined,
          syncSettings.gitPassword || undefined
        );
        setGitStatus(status);
        setGitSyncError(null);
        updateSyncSettings({ lastSuccessfulSyncAt: new Date().toISOString() });
        void refreshGitHistory();
        if (opts?.onAfterPull) {
          await opts.onAfterPull();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setGitSyncError(message);
      } finally {
        setGitSyncAction("idle");
      }
    },
    [refreshGitHistory, syncSettings, updateSyncSettings]
  );

  const gitPush = useCallback(async () => {
    const branch = syncSettings.gitBranch.trim();
    const commitMessage = syncSettings.gitCommitMessage.trim();
    setGitSyncAction("push");
    await yieldToUi();
    try {
      const statusBeforePush = await api.getGitStatus();
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
      updateSyncSettings({ lastSuccessfulSyncAt: new Date().toISOString() });
      void refreshGitHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitSyncError(message);
    } finally {
      setGitSyncAction("idle");
    }
  }, [refreshGitHistory, syncSettings, updateSyncSettings]);

  // One-tap sync: connect (if needed) → push local work → pull/merge remote →
  // push the merged result. Reuses the same primitives as the manual buttons.
  // Pushing first commits local edits so the working tree is clean before the
  // pull (which refuses to run with uncommitted changes); a non-fast-forward
  // rejection on that first push is expected when the other device pushed since,
  // so it is swallowed and reconciled by the pull + final push.
  const syncNow = useCallback(
    async (opts?: {
      remote?: string;
      branch?: string;
      onAfterPull?: () => Promise<void>;
    }) => {
      // An explicit remote (from mDNS discovery or a QR deep link) wins over the
      // stored setting and is persisted so the fields reflect what we synced.
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
        updateSyncSettings({
          gitRemoteUrl: opts.remote,
          ...(opts.branch ? { gitBranch: opts.branch } : {}),
        });
      }

      setGitSyncAction("sync");
      await yieldToUi();
      try {
        let status = gitStatus;
        if (!status?.repo_initialized) {
          status = await api.connectGitRepo(remoteUrl, branch, username, password);
          setGitStatus(status);
        }

        // Commit + push local work first (best effort).
        try {
          const beforeFirstPush = await api.getGitStatus();
          if (beforeFirstPush.push_required) {
            status = await api.gitPush(message, branch, username, password);
            setGitStatus(status);
          }
        } catch {
          // Likely a non-fast-forward rejection — the pull below reconciles it.
        }

        // Merge remote changes (the working tree is clean now).
        const beforePull = await api.getGitStatus();
        setGitStatus(beforePull);
        if (!beforePull.has_uncommitted_changes) {
          status = await api.gitPull(branch, username, password);
          setGitStatus(status);
          if (opts?.onAfterPull) {
            await opts.onAfterPull();
          }
        }

        // Deliver the merged result.
        const beforeFinalPush = await api.getGitStatus();
        setGitStatus(beforeFinalPush);
        if (beforeFinalPush.push_required) {
          status = await api.gitPush(message, branch, username, password);
          setGitStatus(status);
        }

        setGitSyncError(null);
        updateSyncSettings({ lastSuccessfulSyncAt: new Date().toISOString() });
        void refreshGitHistory();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setGitSyncError(errorMessage);
      } finally {
        setGitSyncAction("idle");
      }
    },
    [gitStatus, refreshGitHistory, syncSettings, updateSyncSettings]
  );

  return (
    <GitSyncContext.Provider
      value={{
        gitStatus,
        gitSyncAction,
        gitSyncError,
        gitSyncBusy,
        gitCommitHistory,
        gitHistoryBusy,
        gitHistoryError,
        refreshGitStatus,
        refreshGitHistory,
        connectGitRepo,
        gitPull,
        gitPush,
        syncNow,
        setGitStatus,
        setGitSyncError,
      }}
    >
      {children}
    </GitSyncContext.Provider>
  );
}

export function useGitSync() {
  const context = useContext(GitSyncContext);
  if (!context) {
    throw new Error("useGitSync must be used within a GitSyncProvider");
  }
  return context;
}
