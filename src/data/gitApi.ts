import { invokeLogged } from "./invoke";
import type { GitCommitHistoryEntry, GitSyncStatus } from "../types";

export const getGitStatus = (): Promise<GitSyncStatus> =>
  invokeLogged<GitSyncStatus>("get_git_status");

export const getGitHistory = (limit = 40): Promise<GitCommitHistoryEntry[]> =>
  invokeLogged<GitCommitHistoryEntry[]>("get_git_history", {
    args: { limit },
  });

export const connectGitRepo = (
  remoteUrl: string,
  branch?: string,
  username?: string,
  password?: string
): Promise<GitSyncStatus> =>
  invokeLogged<GitSyncStatus>("connect_git_repo", {
    args: {
      remote_url: remoteUrl,
      branch,
      username,
      password,
    },
  });

export const gitPull = (
  branch?: string,
  username?: string,
  password?: string
): Promise<GitSyncStatus> =>
  invokeLogged<GitSyncStatus>("git_pull", {
    args: {
      branch,
      username,
      password,
    },
  });

export const gitPush = (
  message?: string,
  branch?: string,
  username?: string,
  password?: string
): Promise<GitSyncStatus> =>
  invokeLogged<GitSyncStatus>("git_push", {
    args: {
      message,
      branch,
      username,
      password,
    },
  });
