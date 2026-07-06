import { create } from "zustand";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import { getSyncHint } from "@typenotes/shared/format";
import type {
  ConnectGitArgs,
  GitCommitHistoryEntry,
  GitSyncStatus,
} from "@typenotes/shared/types";

import { useNotesStore } from "./notes-store";
import { activeProfile, useSettingsStore } from "./settings-store";

type SyncAction = "idle" | "refresh" | "connect" | "pull" | "push";

type SyncState = {
  status: GitSyncStatus | null;
  history: GitCommitHistoryEntry[];
  action: SyncAction;
  error: string | null;
  hint: string | null;
  refresh: () => Promise<void>;
  connect: (args: ConnectGitArgs) => Promise<void>;
  pull: () => Promise<void>;
  push: (message?: string) => Promise<void>;
};

export const useSyncStore = create<SyncState>((set) => {
  const savedGitConnection = (): ConnectGitArgs | null => {
    const profile = activeProfile(useSettingsStore.getState().snapshot);
    const settings = profile?.settings;
    const remoteUrl = settings?.git_remote_url.trim();
    if (!settings || !remoteUrl) {
      return null;
    }

    return {
      remote_url: remoteUrl,
      branch: settings.git_branch.trim() || null,
      username: settings.git_username.trim() || null,
      password: settings.git_password || null,
    };
  };

  const ensureSavedRemote = async (
    currentStatus: GitSyncStatus | null,
    connection = savedGitConnection()
  ): Promise<GitSyncStatus | null> => {
    if (!connection?.remote_url) {
      return currentStatus;
    }

    const expectedBranch = connection.branch ?? "main";
    const remoteChanged = currentStatus?.remote_url !== connection.remote_url;
    const branchChanged =
      currentStatus?.current_branch != null &&
      currentStatus.current_branch !== expectedBranch;
    const needsConnect =
      !currentStatus?.repo_initialized || remoteChanged || branchChanged;

    if (!needsConnect) {
      return currentStatus;
    }

    return core.connectGitRepo(connection);
  };

  const run = async (
    action: SyncAction,
    work: () => Promise<GitSyncStatus | null>
  ) => {
    set({ action, error: null, hint: null });
    try {
      const status = await work();
      const history = await core.getGitHistory({ limit: 30 }).catch(() => []);
      set({ ...(status ? { status } : {}), history, action: "idle" });
    } catch (error) {
      const message = getErrorMessage(error);
      set({ action: "idle", error: message, hint: getSyncHint(message) });
      throw error;
    }
  };

  return {
    status: null,
    history: [],
    action: "idle",
    error: null,
    hint: null,

    refresh: () => run("refresh", () => core.getGitStatus()),

    connect: (args) => run("connect", () => core.connectGitRepo(args)),

    pull: async () => {
      await run("pull", async () => {
        const connection = savedGitConnection();
        const status = await ensureSavedRemote(await core.getGitStatus(), connection);
        return core.gitPull({
          branch: connection?.branch,
          username: connection?.username,
          password: connection?.password,
        }).catch((error) => {
          if (status) {
            set({ status });
          }
          throw error;
        });
      });
      // Remote edits may have changed the notes on disk.
      await useNotesStore.getState().refresh();
    },

    push: (message) =>
      run("push", async () => {
        const connection = savedGitConnection();
        const status = await ensureSavedRemote(await core.getGitStatus(), connection);
        return core
          .gitPush({
            ...(message ? { message } : {}),
            branch: connection?.branch,
            username: connection?.username,
            password: connection?.password,
          })
          .catch((error) => {
            if (status) {
              set({ status });
            }
            throw error;
          });
      }),
  };
});
