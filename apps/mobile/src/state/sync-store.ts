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
      await run("pull", () => core.gitPull());
      // Remote edits may have changed the notes on disk.
      await useNotesStore.getState().refresh();
    },

    push: (message) =>
      run("push", () => core.gitPush(message ? { message } : {})),
  };
});
