import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  GitCommitHistoryEntry,
  GitSyncAction,
  GitSyncStatus,
  LocalSyncServerStatus,
} from "@typenotes/shared/types";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { useGitSyncWorkflows } from "./use-git-sync-workflows";
import { useLocalSyncServer } from "./use-local-sync-server";
import {
  readLastSuccessfulSyncAt,
  writeLastSuccessfulSyncAt,
} from "../lib/sync-metadata";

type GitSyncContextValue = {
  gitStatus: GitSyncStatus | null;
  gitSyncAction: GitSyncAction;
  gitSyncError: string | null;
  gitSyncBusy: boolean;
  gitCommitHistory: GitCommitHistoryEntry[];
  gitHistoryBusy: boolean;
  gitHistoryError: string | null;
  lastSuccessfulSyncAt: string;
  localSyncServerStatus: LocalSyncServerStatus | null;
  localSyncServerBusy: boolean;
  localSyncServerError: string | null;
  refreshLocalSyncServer: () => Promise<void>;
  toggleLocalSyncServer: () => Promise<void>;
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
  const [gitStatus, setGitStatus] = useState<GitSyncStatus | null>(null);
  const [gitSyncAction, setGitSyncAction] = useState<GitSyncAction>("idle");
  const [gitSyncError, setGitSyncError] = useState<string | null>(null);
  const [gitCommitHistory, setGitCommitHistory] = useState<GitCommitHistoryEntry[]>([]);
  const [gitHistoryBusy, setGitHistoryBusy] = useState(false);
  const [gitHistoryError, setGitHistoryError] = useState<string | null>(null);
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState("");
  const {
    status: localSyncServerStatus,
    busy: localSyncServerBusy,
    error: localSyncServerError,
    refresh: refreshLocalSyncServer,
    toggle: toggleLocalSyncServer,
  } = useLocalSyncServer();

  const recordSuccessfulSync = useCallback(
    (syncedAt: string) => {
      if (!activeProfileId) return;
      writeLastSuccessfulSyncAt(activeProfileId, syncedAt);
      setLastSuccessfulSyncAt(syncedAt);
    },
    [activeProfileId]
  );
  const {
    gitSyncBusy,
    refreshGitStatus,
    refreshGitHistory,
    connectGitRepo,
    gitPull,
    gitPush,
    syncNow,
  } = useGitSyncWorkflows({
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
    onSuccessfulSync: recordSuccessfulSync,
  });

  useEffect(() => {
    setLastSuccessfulSyncAt(readLastSuccessfulSyncAt(activeProfileId));
    if (!activeProfileId) {
      setGitStatus(null);
      setGitSyncError(null);
      setGitCommitHistory([]);
      setGitHistoryError(null);
      return;
    }
    void refreshGitStatus();
    void refreshGitHistory();
  }, [activeProfileId, refreshGitHistory, refreshGitStatus]);

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
        lastSuccessfulSyncAt,
        localSyncServerStatus,
        localSyncServerBusy,
        localSyncServerError,
        refreshLocalSyncServer,
        toggleLocalSyncServer,
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
