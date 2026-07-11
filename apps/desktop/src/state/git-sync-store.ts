// Git sync domain store: status, history, and the connect/pull/push/sync-now
// workflows over the libgit2 backend. Sync settings are read from the
// profiles store at call time.
import { create } from "zustand";

import * as api from "@/api/git-api";
import { yieldToUi } from "@/lib/browser";
import {
  selectActiveProfileId,
  selectSyncSettings,
  updateSyncSettings,
  useProfilesStore,
} from "@/state/profiles-store";
import { getErrorMessage } from "@typenotes/shared/errors";
import type {
  GitCommitHistoryEntry,
  GitSyncAction,
  GitSyncStatus,
} from "@typenotes/shared/types";

type GitSyncState = {
  status: GitSyncStatus | null;
  action: GitSyncAction;
  error: string | null;
  history: GitCommitHistoryEntry[];
  historyBusy: boolean;
  historyError: string | null;
};

export const useGitSyncStore = create<GitSyncState>(() => ({
  status: null,
  action: "idle",
  error: null,
  history: [],
  historyBusy: false,
  historyError: null,
}));

export const selectGitSyncBusy = (state: GitSyncState) => state.action !== "idle";

const syncSettings = () => selectSyncSettings(useProfilesStore.getState());

const needsGitReconnect = (
  status: GitSyncStatus | null,
  remoteUrl: string,
  branch?: string
) =>
  !status?.repo_initialized ||
  status.remote_url !== remoteUrl ||
  Boolean(branch && status.current_branch && status.current_branch !== branch);

// A freshly connected repo knows its remote/branch before the user has typed
// them into settings; adopt them so the settings form starts filled in.
const adoptStatusIntoSettings = (status: GitSyncStatus | null) => {
  if (!status?.repo_initialized) {
    return;
  }
  const settings = syncSettings();
  const patch: Partial<typeof settings> = {};
  if (!settings.gitRemoteUrl.trim() && status.remote_url) {
    patch.gitRemoteUrl = status.remote_url;
  }
  if (!settings.gitBranch.trim() && status.current_branch) {
    patch.gitBranch = status.current_branch;
  }
  if (Object.keys(patch).length > 0) {
    void updateSyncSettings(patch);
  }
};

const setStatus = (status: GitSyncStatus | null) => {
  useGitSyncStore.setState({ status });
  adoptStatusIntoSettings(status);
};

export async function refreshGitStatus() {
  useGitSyncStore.setState({ action: "refresh" });
  await yieldToUi();
  try {
    setStatus(await api.getGitStatus());
    useGitSyncStore.setState({ error: null });
  } catch (error) {
    useGitSyncStore.setState({ error: getErrorMessage(error) });
  } finally {
    useGitSyncStore.setState({ action: "idle" });
  }
}

export async function refreshGitHistory(limit = 40) {
  useGitSyncStore.setState({ historyBusy: true });
  await yieldToUi();
  try {
    const history = await api.getGitHistory(limit);
    useGitSyncStore.setState({ history, historyError: null });
  } catch (error) {
    useGitSyncStore.setState({
      history: [],
      historyError: getErrorMessage(error),
    });
  } finally {
    useGitSyncStore.setState({ historyBusy: false });
  }
}

export async function connectGitRepo() {
  const settings = syncSettings();
  const remoteUrl = settings.gitRemoteUrl.trim();
  const branch = settings.gitBranch.trim();
  if (!remoteUrl) {
    useGitSyncStore.setState({ error: "Remote repository URL is required." });
    return;
  }
  useGitSyncStore.setState({ action: "connect" });
  await yieldToUi();
  try {
    const status = await api.connectGitRepo(
      remoteUrl,
      branch || undefined,
      settings.gitUsername.trim() || undefined,
      settings.gitPassword || undefined
    );
    setStatus(status);
    useGitSyncStore.setState({ error: null });
    void refreshGitHistory();
  } catch (error) {
    useGitSyncStore.setState({ error: getErrorMessage(error) });
  } finally {
    useGitSyncStore.setState({ action: "idle" });
  }
}

async function ensureConfiguredGitRemote(status: GitSyncStatus | null) {
  const settings = syncSettings();
  const remoteUrl = settings.gitRemoteUrl.trim();
  const branch = settings.gitBranch.trim() || undefined;

  if (!remoteUrl || !needsGitReconnect(status, remoteUrl, branch)) {
    return status;
  }

  const connectedStatus = await api.connectGitRepo(
    remoteUrl,
    branch,
    settings.gitUsername.trim() || undefined,
    settings.gitPassword || undefined
  );
  setStatus(connectedStatus);
  return connectedStatus;
}

export async function gitPull(opts?: { onAfterPull?: () => Promise<void> }) {
  const settings = syncSettings();
  useGitSyncStore.setState({ action: "pull" });
  await yieldToUi();
  try {
    await ensureConfiguredGitRemote(await api.getGitStatus());
    const status = await api.gitPull(
      settings.gitBranch.trim() || undefined,
      settings.gitUsername.trim() || undefined,
      settings.gitPassword || undefined
    );
    setStatus(status);
    useGitSyncStore.setState({ error: null });
    void updateSyncSettings({ lastSuccessfulSyncAt: new Date().toISOString() });
    void refreshGitHistory();
    if (opts?.onAfterPull) {
      await opts.onAfterPull();
    }
  } catch (error) {
    useGitSyncStore.setState({ error: getErrorMessage(error) });
  } finally {
    useGitSyncStore.setState({ action: "idle" });
  }
}

export async function gitPush() {
  const settings = syncSettings();
  useGitSyncStore.setState({ action: "push" });
  await yieldToUi();
  try {
    const statusBeforePush = await ensureConfiguredGitRemote(await api.getGitStatus());
    if (!statusBeforePush) {
      useGitSyncStore.setState({ error: "Remote repository URL is required." });
      return;
    }
    setStatus(statusBeforePush);
    if (!statusBeforePush.push_required) {
      useGitSyncStore.setState({ error: null });
      void refreshGitHistory();
      return;
    }
    const status = await api.gitPush(
      settings.gitCommitMessage.trim() || undefined,
      settings.gitBranch.trim() || undefined,
      settings.gitUsername.trim() || undefined,
      settings.gitPassword || undefined
    );
    setStatus(status);
    useGitSyncStore.setState({ error: null });
    void updateSyncSettings({ lastSuccessfulSyncAt: new Date().toISOString() });
    void refreshGitHistory();
  } catch (error) {
    useGitSyncStore.setState({ error: getErrorMessage(error) });
  } finally {
    useGitSyncStore.setState({ action: "idle" });
  }
}

// One-tap sync: connect (if needed) -> push local work -> pull/merge remote
// -> push the merged result. The sequence matches the manual controls, but it
// absorbs the expected first-push rejection when another device has already
// advanced the remote branch.
export async function syncNow(opts?: {
  remote?: string;
  branch?: string;
  onAfterPull?: () => Promise<void>;
}) {
  const settings = syncSettings();
  // An explicit remote from discovery wins over the stored setting.
  const remoteUrl = (opts?.remote ?? settings.gitRemoteUrl).trim();
  if (!remoteUrl) {
    useGitSyncStore.setState({ error: "Remote repository URL is required." });
    return;
  }
  const branch = (opts?.branch ?? settings.gitBranch).trim() || undefined;
  const username = settings.gitUsername.trim() || undefined;
  const password = settings.gitPassword || undefined;
  const message = settings.gitCommitMessage.trim() || undefined;

  if (opts?.remote) {
    void updateSyncSettings({
      gitRemoteUrl: opts.remote,
      ...(opts.branch ? { gitBranch: opts.branch } : {}),
    });
  }

  useGitSyncStore.setState({ action: "sync" });
  await yieldToUi();
  try {
    let status = await api
      .getGitStatus()
      .catch(() => useGitSyncStore.getState().status);
    if (needsGitReconnect(status, remoteUrl, branch)) {
      status = await api.connectGitRepo(remoteUrl, branch, username, password);
      setStatus(status);
    }

    try {
      const beforeFirstPush = await api.getGitStatus();
      if (beforeFirstPush.push_required) {
        status = await api.gitPush(message, branch, username, password);
        setStatus(status);
      }
    } catch {
      // A rejected first push is fine here: the pull below reconciles it.
    }

    const beforePull = await api.getGitStatus();
    setStatus(beforePull);
    if (!beforePull.has_uncommitted_changes) {
      status = await api.gitPull(branch, username, password);
      setStatus(status);
      if (opts?.onAfterPull) {
        await opts.onAfterPull();
      }
    }

    const beforeFinalPush = await api.getGitStatus();
    setStatus(beforeFinalPush);
    if (beforeFinalPush.push_required) {
      status = await api.gitPush(message, branch, username, password);
      setStatus(status);
    }

    useGitSyncStore.setState({ error: null });
    void updateSyncSettings({ lastSuccessfulSyncAt: new Date().toISOString() });
    void refreshGitHistory();
  } catch (error) {
    useGitSyncStore.setState({ error: getErrorMessage(error) });
  } finally {
    useGitSyncStore.setState({ action: "idle" });
  }
}

/** Follow profile switches: clear on none, refresh on a new active profile. */
export function initGitSync() {
  useProfilesStore.subscribe((state, previous) => {
    const activeProfileId = selectActiveProfileId(state);
    if (activeProfileId === selectActiveProfileId(previous)) {
      return;
    }
    if (!activeProfileId) {
      useGitSyncStore.setState({
        status: null,
        error: null,
        history: [],
        historyError: null,
      });
      return;
    }
    void refreshGitStatus();
    void refreshGitHistory();
  });
}
