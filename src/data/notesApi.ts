import { invoke } from "@tauri-apps/api/core";
import type { FolderNode, GitSyncStatus, NoteMeta } from "../types";

const LOG_PREFIX = "[notes]";
const SENSITIVE_PATTERN = /(password|token|secret)/i;

const sanitizeForLog = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeForLog);
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
      if (SENSITIVE_PATTERN.test(key)) {
        next[key] = "[REDACTED]";
      } else {
        next[key] = sanitizeForLog(nested);
      }
    });
    return next;
  }
  return value;
};

const invokeLogged = async <T,>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> => {
  console.groupCollapsed(`${LOG_PREFIX} invoke ${command}`);
  if (args) {
    console.log("args", sanitizeForLog(args));
  }
  try {
    const result = await invoke<T>(command, args);
    console.log("result", result);
    console.groupEnd();
    return result;
  } catch (error) {
    console.error("error", error);
    console.groupEnd();
    throw error;
  }
};

export const logGroup = (label: string, data?: Record<string, unknown>) => {
  console.groupCollapsed(`${LOG_PREFIX} ${label}`);
  if (data) {
    console.log(data);
  }
  console.groupEnd();
};

export const getTree = (): Promise<FolderNode> =>
  invokeLogged<FolderNode>("get_tree");

export const readNote = (path: string): Promise<string> =>
  invokeLogged<string>("read_note", { path });

export const writeNote = (path: string, content: string): Promise<void> =>
  invokeLogged("write_note", { path, content });

export const getNoteMeta = (path: string): Promise<NoteMeta> =>
  invokeLogged<NoteMeta>("get_note_meta", { path });

export const deleteItems = (items: string[]): Promise<void> =>
  invokeLogged("delete_items", { items });

export const moveItems = (items: string[], destination: string): Promise<void> =>
  invokeLogged("move_items", { items, destination });

export const renameItem = (path: string, newName: string): Promise<string> =>
  invokeLogged<string>("rename_item", { path, newName });

export type SetOrderArgs = {
  parent: string;
  folderOrder: string[];
  noteOrder: string[];
};

export const setOrder = (args: SetOrderArgs): Promise<void> =>
  invokeLogged("set_order", { args });

export const getGitStatus = (): Promise<GitSyncStatus> =>
  invokeLogged<GitSyncStatus>("get_git_status");

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
