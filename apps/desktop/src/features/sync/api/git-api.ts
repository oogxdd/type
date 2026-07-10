import { invokeLogged } from "@/shared/api/invoke";
import type {
  DiscoveredServer,
  GitCommitHistoryEntry,
  GitSyncStatus,
  LocalSyncServerStatus,
} from "@typenotes/shared/types";

export const generateSshKey = (): Promise<string> =>
  invokeLogged<string>("generate_ssh_key");

export const getSshPublicKey = (): Promise<string | null> =>
  invokeLogged<string | null>("get_ssh_public_key");

export const deleteSshKey = (): Promise<void> =>
  invokeLogged<void>("delete_ssh_key");

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

// ── Local network ("LAN" / iPhone-hotspot) git server (desktop host role) ──

export const getLocalSyncServerStatus = (): Promise<LocalSyncServerStatus> =>
  invokeLogged<LocalSyncServerStatus>("get_local_sync_server_status");

export const startLocalSyncServer = (): Promise<LocalSyncServerStatus> =>
  invokeLogged<LocalSyncServerStatus>("start_local_sync_server");

export const startLocalSyncRequestListener = (): Promise<LocalSyncServerStatus> =>
  invokeLogged<LocalSyncServerStatus>("start_local_sync_request_listener");

export const openLocalSyncWindow = (): Promise<LocalSyncServerStatus> =>
  invokeLogged<LocalSyncServerStatus>("open_local_sync_window");

export const closeLocalSyncWindow = (): Promise<LocalSyncServerStatus> =>
  invokeLogged<LocalSyncServerStatus>("close_local_sync_window");

export const approveLocalSyncRequest = (): Promise<LocalSyncServerStatus> =>
  invokeLogged<LocalSyncServerStatus>("approve_local_sync_request");

export const declineLocalSyncRequest = (): Promise<LocalSyncServerStatus> =>
  invokeLogged<LocalSyncServerStatus>("decline_local_sync_request");

export const stopLocalSyncServer = (): Promise<LocalSyncServerStatus> =>
  invokeLogged<LocalSyncServerStatus>("stop_local_sync_server");

// Browse the local network (mDNS) for advertised sync servers.
export const discoverLocalSyncServers = (
  timeoutMs?: number
): Promise<DiscoveredServer[]> =>
  invokeLogged<DiscoveredServer[]>("discover_local_sync_servers", {
    timeout_ms: timeoutMs,
  });
