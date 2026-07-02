import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  GitCommitHistoryEntry,
  GitSyncAction,
  GitSyncStatus,
} from "@typenotes/shared/types";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { useLayoutMode } from "@/mobile/use-layout-mode";
import { useGitSyncWorkflows } from "./use-git-sync-workflows";

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
  });

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
