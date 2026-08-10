import { create } from "zustand";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import { getSyncHint } from "@typenotes/shared/format";
import {
  stripPairingUsernameFromSshRemote,
  type SyncDeepLinkParams,
} from "@typenotes/shared/sync-link";
import type {
  ConnectGitArgs,
  GitCommitHistoryEntry,
  GitSyncStatus,
  GitTransferProgress,
} from "@typenotes/shared/types";

import { useNotesStore } from "./notes-store";
import { activeProfile, useSettingsStore } from "./settings-store";

type SyncAction = "idle" | "refresh" | "connect" | "pull" | "push";
type SavedGitConnection = ConnectGitArgs & { irohTicket: string | null };

const sshHostFromRemote = (remote: string): string => {
  const match = remote.match(/^ssh:\/\/(?:[^@/]+@)?(\[[^\]]+\]|[^/:]+)(?::\d+)?(?:\/|$)/i);
  return match?.[1]?.replace(/^\[|\]$/g, "") ?? "";
};

const redactRemoteForLog = (remote: string | null | undefined): string => {
  if (!remote) {
    return "<none>";
  }
  const match = remote.match(/^([a-z][a-z0-9+.-]*:\/\/)([^@/?#]+)@(.+)$/i);
  if (!match) {
    return remote;
  }
  const [, scheme, userinfo, rest] = match;
  if (scheme.toLowerCase() === "ssh://" && userinfo.toLowerCase().startsWith("pair-")) {
    const token = userinfo.slice("pair-".length);
    return `${scheme}pair-<token:${token.slice(-6)}>@${rest}`;
  }
  return `${scheme}${userinfo.includes(":") ? "<credentials>" : userinfo}@${rest}`;
};

const statusForLog = (status: GitSyncStatus | null): string =>
  status
    ? `repo=${status.repo_initialized} branch=${status.current_branch ?? "<none>"} remote=${redactRemoteForLog(
        status.remote_url
      )} ahead=${status.ahead} behind=${status.behind} dirty=${status.has_uncommitted_changes} push=${status.push_required}`
    : "status=<none>";

const logSync = (message: string) => console.log(`[sync] ${message}`);

type SyncState = {
  status: GitSyncStatus | null;
  history: GitCommitHistoryEntry[];
  action: SyncAction;
  /** Live transfer progress of the running pull/push, null when idle. */
  progress: GitTransferProgress | null;
  error: string | null;
  hint: string | null;
  /** A scanned/deep-linked type2://sync remote waiting to be applied. */
  pendingLink: SyncDeepLinkParams | null;
  setPendingLink: (link: SyncDeepLinkParams | null) => void;
  refresh: () => Promise<void>;
  connect: (args: ConnectGitArgs) => Promise<void>;
  /** Persist a scanned sync link to the working folder's settings + connect. */
  connectFromLink: (link: SyncDeepLinkParams) => Promise<void>;
  pull: () => Promise<void>;
  push: (message?: string) => Promise<void>;
  /** The one-button flow: pull, then push. */
  syncNow: () => Promise<void>;
};

export const useSyncStore = create<SyncState>((set, get) => {
  const savedGitConnection = (): SavedGitConnection | null => {
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
      irohTicket: settings.git_iroh_ticket.trim() || null,
    };
  };

  const prepareIrohConnection = async (
    connection: SavedGitConnection | null
  ): Promise<ConnectGitArgs | null> => {
    if (!connection?.remote_url || !connection.irohTicket) {
      return connection;
    }
    logSync("iroh: ensuring phone loopback proxy is running");
    const proxy = await core.startIrohSyncClient({
      ticket: connection.irohTicket,
      remote_url: connection.remote_url,
    });
    logSync(`iroh: proxy ready port=${proxy.local_port} endpoint=${proxy.endpoint_id}`);
    return { ...connection, remote_url: proxy.local_remote_url };
  };

  const ensureSavedRemote = async (
    currentStatus: GitSyncStatus | null,
    connection = savedGitConnection()
  ): Promise<GitSyncStatus | null> => {
    if (!connection?.remote_url) {
      logSync(`saved remote: none; ${statusForLog(currentStatus)}`);
      return currentStatus;
    }

    const expectedBranch = connection.branch ?? "main";
    const remoteChanged = currentStatus?.remote_url !== connection.remote_url;
    const durableSavedRemote = stripPairingUsernameFromSshRemote(connection.remote_url);
    const savedRemoteIsPairing = durableSavedRemote !== connection.remote_url;
    if (savedRemoteIsPairing && currentStatus?.remote_url === durableSavedRemote) {
      logSync(
        `saved remote: ignoring stale pairing URL because repo origin is durable remote=${redactRemoteForLog(
          currentStatus.remote_url
        )}`
      );
      return currentStatus;
    }
    const branchChanged =
      currentStatus?.current_branch != null &&
      currentStatus.current_branch !== expectedBranch;
    const needsConnect =
      !currentStatus?.repo_initialized || remoteChanged || branchChanged;

    if (!needsConnect) {
      logSync(`saved remote: already applied; ${statusForLog(currentStatus)}`);
      return currentStatus;
    }

    logSync(
      `saved remote: applying origin remote=${redactRemoteForLog(
        connection.remote_url
      )} branch=${expectedBranch} reason repo=${!currentStatus?.repo_initialized} remoteChanged=${remoteChanged} branchChanged=${branchChanged}`
    );
    return core.connectGitRepo(connection);
  };

  const run = async (
    action: SyncAction,
    work: () => Promise<GitSyncStatus | null>
  ) => {
    const startedAt = Date.now();
    logSync(`${action}: started`);
    set({ action, error: null, hint: null });
    // Surface libgit2's transfer progress (objects/bytes) while the network
    // action runs; the core publishes a snapshot that is cheap to poll.
    const progressTimer =
      action === "refresh"
        ? null
        : setInterval(() => {
            const progress = core.getGitSyncProgress();
            set({ progress: progress.phase === "idle" ? null : progress });
          }, 250);
    try {
      const status = await work();
      const history = await core.getGitHistory({ limit: 30 }).catch(() => []);
      logSync(`${action}: done in ${Date.now() - startedAt}ms; ${statusForLog(status)}`);
      set({ ...(status ? { status } : {}), history, action: "idle" });
    } catch (error) {
      const message = getErrorMessage(error);
      logSync(`${action}: failed after ${Date.now() - startedAt}ms - ${message}`);
      set({ action: "idle", error: message, hint: getSyncHint(message) });
      throw error;
    } finally {
      if (progressTimer) {
        clearInterval(progressTimer);
      }
      set({ progress: null });
    }
  };

  const isBusy = (requestedAction: string): boolean => {
    const active = get().action;
    if (active === "idle") {
      return false;
    }
    logSync(`${requestedAction}: ignored because ${active} is in progress`);
    return true;
  };

  const requireIdle = (requestedAction: string) => {
    const active = get().action;
    if (active === "idle") {
      return;
    }
    const message = `${requestedAction}: cannot start while ${active} is in progress`;
    logSync(message);
    set({ error: message, hint: null });
    throw new Error(message);
  };

  return {
    status: null,
    history: [],
    action: "idle",
    progress: null,
    error: null,
    hint: null,
    pendingLink: null,

    setPendingLink: (link) => set({ pendingLink: link }),

    refresh: () => run("refresh", () => core.getGitStatus()),

    connect: (args) => run("connect", () => core.connectGitRepo(args)),

    connectFromLink: async (link) => {
      requireIdle("qr connect");
      await run("connect", async () => {
        const settingsStore = useSettingsStore.getState();
        const profile = activeProfile(settingsStore.snapshot);
        const pairingRemote = link.irohTicket
          ? (
              await core.startIrohSyncClient({
                ticket: link.irohTicket,
                remote_url: link.remote,
              })
            ).local_remote_url
          : link.remote;
        const trustedSshHost = link.hostKeySha256
          ? sshHostFromRemote(pairingRemote)
          : "";
        const durableRemote = stripPairingUsernameFromSshRemote(pairingRemote);
        logSync(
          `qr: applying link remote=${redactRemoteForLog(pairingRemote)} durable=${redactRemoteForLog(
            durableRemote
          )} branch=${link.branch ?? "main"} iroh=${Boolean(link.irohTicket)} hostPin=${Boolean(
            link.hostKeySha256
          )} trustedHost=${
            trustedSshHost || "<none>"
          }`
        );
        const saveLinkSettingsBestEffort = async (remoteUrl: string) => {
          try {
            logSync(`qr: saving durable settings ${redactRemoteForLog(remoteUrl)}`);
            await settingsStore.saveGitSettings({
              remoteUrl,
              branch: link.branch ?? "main",
              username: profile?.settings.git_username ?? "",
              password: profile?.settings.git_password ?? "",
              commitMessage: profile?.settings.git_commit_message || "Sync notes",
              trustedSshHost,
              trustedSshHostKeySha256: trustedSshHost ? link.hostKeySha256 ?? "" : "",
              irohTicket: link.irohTicket ?? null,
            });
          } catch (error) {
            logSync(
              `qr: settings save failed but git origin was already updated - ${getErrorMessage(
                error
              )}`
            );
          }
        };
        if (pairingRemote.toLowerCase().startsWith("ssh://")) {
          const existingKey = await core.getSshPublicKey();
          if (!existingKey) {
            logSync("ssh key: none found; generating app-managed key");
            await core.generateSshKey();
          } else {
            logSync("ssh key: existing app-managed key found");
          }
        }
        logSync(`qr: connecting with pairing remote ${redactRemoteForLog(pairingRemote)}`);
        const pairingStatus = await core.connectGitRepo({
          remote_url: pairingRemote,
          branch: link.branch ?? "main",
          username: null,
          password: null,
        });
        if (durableRemote !== pairingRemote) {
          logSync(
            `qr: pairing connect succeeded; applying durable origin ${redactRemoteForLog(
              durableRemote
            )}`
          );
          const durableStatus = await core.connectGitRepo({
            remote_url: durableRemote,
            branch: link.branch ?? "main",
            username: null,
            password: null,
          });
          await saveLinkSettingsBestEffort(durableRemote);
          return durableStatus;
        }
        await saveLinkSettingsBestEffort(pairingRemote);
        return pairingStatus;
      });
    },

    pull: async () => {
      if (isBusy("pull")) {
        return;
      }
      await run("pull", async () => {
        const connection = await prepareIrohConnection(savedGitConnection());
        logSync(
          `pull: saved connection remote=${redactRemoteForLog(connection?.remote_url)} branch=${
            connection?.branch ?? "main"
          }`
        );
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
      logSync("pull: notes refreshed after remote changes");
    },

    syncNow: async () => {
      if (isBusy("sync now")) {
        return;
      }
      logSync("sync now: starting pull then push");
      await get().pull();
      logSync("sync now: pull complete; starting push");
      await get().push();
    },

    push: async (message) => {
      if (isBusy("push")) {
        return;
      }
      await run("push", async () => {
        const connection = await prepareIrohConnection(savedGitConnection());
        logSync(
          `push: saved connection remote=${redactRemoteForLog(connection?.remote_url)} branch=${
            connection?.branch ?? "main"
          } message=${message ? "custom" : "default"}`
        );
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
      });
    },
  };
});
