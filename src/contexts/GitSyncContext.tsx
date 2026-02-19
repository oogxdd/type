import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import * as api from "../data/notesApi";
import type {
  GitCommitHistoryEntry,
  GitSyncAction,
  GitSyncStatus,
} from "../types";
import { yieldToUi } from "../utils/notes";
import { useSessions } from "./SessionsContext";

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
  setGitStatus: (status: GitSyncStatus | null) => void;
  setGitSyncError: (error: string | null) => void;
};

const GitSyncContext = createContext<GitSyncContextValue | null>(null);

export function GitSyncProvider({ children }: { children: ReactNode }) {
  const { activeSessionId, syncSettings, updateSyncSettings } = useSessions();
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
    if (!activeSessionId) {
      setGitCommitHistory([]);
      setGitHistoryError(null);
      return;
    }
    void refreshGitHistory();
  }, [activeSessionId, refreshGitHistory]);

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
