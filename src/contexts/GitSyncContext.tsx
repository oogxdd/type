import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import * as api from "../data/notesApi";
import type { GitSyncAction, GitSyncHistoryEntry, GitSyncHistoryStatusSnapshot, GitSyncStatus } from "../types";
import { MAX_GIT_SYNC_HISTORY_ITEMS } from "../constants";
import { readGitSyncHistoryStore, writeGitSyncHistoryStore } from "../utils/storage";
import { yieldToUi } from "../utils/notes";
import { useSessions } from "./SessionsContext";

type GitSyncContextValue = {
  gitStatus: GitSyncStatus | null;
  gitSyncAction: GitSyncAction;
  gitSyncError: string | null;
  gitSyncBusy: boolean;
  gitSyncHistory: GitSyncHistoryEntry[];
  refreshGitStatus: () => Promise<void>;
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
  const [gitSyncHistory, setGitSyncHistory] = useState<GitSyncHistoryEntry[]>([]);
  const [gitSyncHistorySessionId, setGitSyncHistorySessionId] = useState<string | null>(null);

  const gitSyncBusy = gitSyncAction !== "idle";

  // Load history when session changes
  useEffect(() => {
    if (!activeSessionId) {
      setGitSyncHistory([]);
      setGitSyncHistorySessionId(null);
      return;
    }
    const store = readGitSyncHistoryStore();
    setGitSyncHistory(store[activeSessionId] ?? []);
    setGitSyncHistorySessionId(activeSessionId);
  }, [activeSessionId]);

  // Persist history
  useEffect(() => {
    if (!activeSessionId || gitSyncHistorySessionId !== activeSessionId) {
      return;
    }
    const store = readGitSyncHistoryStore();
    store[activeSessionId] = gitSyncHistory.slice(0, MAX_GIT_SYNC_HISTORY_ITEMS);
    writeGitSyncHistoryStore(store);
  }, [activeSessionId, gitSyncHistory, gitSyncHistorySessionId]);

  const snapshotGitStatus = useCallback(
    (status: GitSyncStatus | null): GitSyncHistoryStatusSnapshot | null => {
      if (!status) {
        return null;
      }
      return {
        repo_initialized: status.repo_initialized,
        current_branch: status.current_branch,
        remote_url: status.remote_url,
        has_uncommitted_changes: status.has_uncommitted_changes,
        push_required: status.push_required,
        ahead: status.ahead,
        behind: status.behind,
      };
    },
    []
  );

  const appendGitSyncHistory = useCallback(
    (entry: Omit<GitSyncHistoryEntry, "id"> & { id?: string }) => {
      const nextEntry: GitSyncHistoryEntry = {
        ...entry,
        id: entry.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
      setGitSyncHistory((previous) =>
        [nextEntry, ...previous].slice(0, MAX_GIT_SYNC_HISTORY_ITEMS)
      );
    },
    []
  );

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

  const connectGitRepo = useCallback(async () => {
    const remoteUrl = syncSettings.gitRemoteUrl.trim();
    const branch = syncSettings.gitBranch.trim();
    if (!remoteUrl) {
      setGitSyncError("Remote repository URL is required.");
      return;
    }
    const startedAt = new Date().toISOString();
    const before = snapshotGitStatus(gitStatus);
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
      appendGitSyncHistory({
        action: "connect",
        status: "success",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        branch: branch || status.current_branch || "",
        remote_url: remoteUrl || status.remote_url || "",
        before,
        after: snapshotGitStatus(status),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitSyncError(message);
      appendGitSyncHistory({
        action: "connect",
        status: "error",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        branch: branch || "",
        remote_url: remoteUrl,
        error_message: message,
        before,
        after: snapshotGitStatus(gitStatus),
      });
    } finally {
      setGitSyncAction("idle");
    }
  }, [appendGitSyncHistory, gitStatus, snapshotGitStatus, syncSettings]);

  const gitPull = useCallback(
    async (opts?: { onAfterPull?: () => Promise<void> }) => {
      const branch = syncSettings.gitBranch.trim();
      const remoteUrl = syncSettings.gitRemoteUrl.trim() || gitStatus?.remote_url || "";
      const startedAt = new Date().toISOString();
      const before = snapshotGitStatus(gitStatus);
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
        appendGitSyncHistory({
          action: "pull",
          status: "success",
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          branch: branch || status.current_branch || "",
          remote_url: remoteUrl || status.remote_url || "",
          before,
          after: snapshotGitStatus(status),
        });
        if (opts?.onAfterPull) {
          await opts.onAfterPull();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setGitSyncError(message);
        appendGitSyncHistory({
          action: "pull",
          status: "error",
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          branch: branch || "",
          remote_url: remoteUrl,
          error_message: message,
          before,
          after: snapshotGitStatus(gitStatus),
        });
      } finally {
        setGitSyncAction("idle");
      }
    },
    [appendGitSyncHistory, gitStatus, snapshotGitStatus, syncSettings, updateSyncSettings]
  );

  const gitPush = useCallback(async () => {
    const branch = syncSettings.gitBranch.trim();
    const remoteUrl = syncSettings.gitRemoteUrl.trim() || gitStatus?.remote_url || "";
    const commitMessage = syncSettings.gitCommitMessage.trim();
    const startedAt = new Date().toISOString();
    let before = snapshotGitStatus(gitStatus);
    setGitSyncAction("push");
    await yieldToUi();
    try {
      const statusBeforePush = await api.getGitStatus();
      setGitStatus(statusBeforePush);
      before = snapshotGitStatus(statusBeforePush);
      if (!statusBeforePush.push_required) {
        setGitSyncError(null);
        appendGitSyncHistory({
          action: "push",
          status: "success",
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          branch: branch || statusBeforePush.current_branch || "",
          remote_url: remoteUrl || statusBeforePush.remote_url || "",
          commit_message: commitMessage || undefined,
          before,
          after: snapshotGitStatus(statusBeforePush),
        });
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
      appendGitSyncHistory({
        action: "push",
        status: "success",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        branch: branch || status.current_branch || "",
        remote_url: remoteUrl || status.remote_url || "",
        commit_message: commitMessage || undefined,
        before,
        after: snapshotGitStatus(status),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitSyncError(message);
      appendGitSyncHistory({
        action: "push",
        status: "error",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        branch: branch || "",
        remote_url: remoteUrl,
        commit_message: commitMessage || undefined,
        error_message: message,
        before,
        after: snapshotGitStatus(gitStatus),
      });
    } finally {
      setGitSyncAction("idle");
    }
  }, [appendGitSyncHistory, gitStatus, snapshotGitStatus, syncSettings, updateSyncSettings]);

  return (
    <GitSyncContext.Provider
      value={{
        gitStatus,
        gitSyncAction,
        gitSyncError,
        gitSyncBusy,
        gitSyncHistory,
        refreshGitStatus,
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
