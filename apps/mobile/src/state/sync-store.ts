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
  IrohClientStatus,
} from "@typenotes/shared/types";

import {
  autoSyncRetryDelayMs,
  saveReasonHasLocalChanges,
  type AutoSyncState,
} from "../lib/sync-experience";
import { useDiagnosticsStore } from "./diagnostics-store";
import { useNotesStore } from "./notes-store";
import { activeProfile, useSettingsStore } from "./settings-store";
import { useSyncLogStore } from "./sync-log-store";

type SyncAction = "idle" | "refresh" | "connect" | "pull" | "push";
type SavedGitConnection = ConnectGitArgs & { irohTicket: string | null };
const AUTO_SYNC_DELAY_MS = 1_500;
const AUTO_SYNC_BUSY_RETRY_MS = 2_000;
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
let autoSyncFailureCount = 0;

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

const logSync = (message: string) => {
  console.log(`[sync] ${message}`);
  if (useDiagnosticsStore.getState().diagnostics.captureSyncLogs) {
    useSyncLogStore.getState().push(message);
  }
};

type SyncState = {
  status: GitSyncStatus | null;
  history: GitCommitHistoryEntry[];
  action: SyncAction;
  /** Live transfer progress of the running pull/push, null when idle. */
  progress: GitTransferProgress | null;
  error: string | null;
  hint: string | null;
  autoSyncState: AutoSyncState | null;
  lastAutoSyncedAt: number | null;
  /** Phase two of sync: recordings moving to the computer over Iroh after
   * notes have already pushed. Null until a push with a paired connection has
   * run this session; never blocks `action`/`autoSyncState`. */
  audioArchiveState: "archiving" | "done" | "error" | null;
  /** How the direct connection to the computer is doing, for the Sync screen's
   * connection panel. Null until a proxy has run this session. */
  irohStatus: IrohClientStatus | null;
  /** A scanned/deep-linked type2://sync remote waiting to be applied. */
  pendingLink: SyncDeepLinkParams | null;
  setPendingLink: (link: SyncDeepLinkParams | null) => void;
  refreshIrohStatus: () => Promise<void>;
  refresh: () => Promise<void>;
  connect: (args: ConnectGitArgs) => Promise<void>;
  /** Persist a scanned sync link to the working folder's settings + connect. */
  connectFromLink: (link: SyncDeepLinkParams) => Promise<void>;
  pull: () => Promise<void>;
  push: (message?: string) => Promise<void>;
  /** The one-button flow: pull, then push. */
  syncNow: () => Promise<void>;
  /** Debounced, best-effort sync used after saves and foregrounding. */
  scheduleAutoSync: (reason: string, delayMs?: number) => void;
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
    set({ irohStatus: proxy });
    logSync(
      `iroh: proxy ready port=${proxy.local_port} computer=${proxy.endpoint_id} path=${proxy.connection} audioPaired=${proxy.paired}`
    );
    return { ...connection, remote_url: proxy.local_remote_url };
  };

  // Sync runs in two phases: notes over git first (what the user is actually
  // waiting on), then recordings over Iroh as a best-effort follow-up. Audio
  // transfer talks to a relay/NAT path that can stall for a while even with
  // the core-side timeouts, so it must never sit in front of the git push the
  // way it used to — that turned one slow recording into "syncing forever"
  // with the notes never leaving the phone.
  const applyAudioGitExclusionFast = async (connection: SavedGitConnection | null) => {
    // Local-only flag flip: whether audio should ride in git (unpaired
    // fallback) or be excluded (Iroh will carry it). Cheap, so it stays ahead
    // of the push/pull it affects; the slow part (actually moving bytes) is
    // archiveAudioBestEffort below.
    try {
      await core.setMobileAudioGitExclusion(Boolean(connection?.irohTicket));
    } catch (error) {
      logSync(`audio git exclusion: skipped - ${getErrorMessage(error)}`);
    }
  };

  let audioArchiveInFlight = false;
  const archiveAudioBestEffort = (connection: SavedGitConnection | null) => {
    if (!connection?.irohTicket || audioArchiveInFlight) {
      return;
    }
    audioArchiveInFlight = true;
    set({ audioArchiveState: "archiving" });
    void (async () => {
      // Recordings travel outside Git. Trouble moving them must not stop the
      // notes from syncing — the notes are what the user is waiting on, and an
      // unpaired phone keeps carrying its audio in Git as a fallback.
      try {
        const archive = await core.archiveMobileAudioWithIroh();
        if (archive.uploaded > 0) {
          logSync(`audio archive: copied ${archive.uploaded} recording(s) to the computer over Iroh`);
        }
        if (archive.skipped > 0) {
          logSync(
            `audio archive: keeping ${archive.skipped} recording(s) in Git - ${
              archive.error ?? "audio transfer is not paired"
            }`
          );
        }
        if (archive.failed > 0) {
          logSync(
            `audio archive: ${archive.failed} recording(s) did not make it this run - ${
              archive.error ?? "unknown error"
            }; will retry next sync`
          );
        }
        set({ audioArchiveState: archive.failed > 0 ? "error" : "done" });
      } catch (error) {
        logSync(`audio archive: skipped this run - ${getErrorMessage(error)}`);
        set({ audioArchiveState: "error" });
      }
      try {
        const prune = await core.pruneMobileAudioCache();
        if (prune.evicted > 0) {
          logSync(`audio cache: evicted ${prune.evicted} verified week-old recording(s)`);
        }
      } catch (error) {
        logSync(`audio cache: prune skipped - ${getErrorMessage(error)}`);
      }
      audioArchiveInFlight = false;
    })();
  };

  /**
   * A sync that fails on the direct connection surfaces as a libgit2 error
   * about a loopback port, which tells the user nothing actionable. When the
   * transport is what actually broke, report that instead.
   */
  const explainWithTransport = async (message: string): Promise<string> => {
    const connection = savedGitConnection();
    if (!connection?.irohTicket || !connection.remote_url) {
      return message;
    }
    try {
      const status = await core.getIrohClientStatus(connection.remote_url);
      if (status) {
        set({ irohStatus: status });
      }
      return status?.last_error ?? message;
    } catch {
      return message;
    }
  };

  const ensureSavedRemote = async (
    currentStatus: GitSyncStatus | null,
    connection: ConnectGitArgs | null = savedGitConnection()
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
      const raw = getErrorMessage(error);
      logSync(`${action}: failed after ${Date.now() - startedAt}ms - ${raw}`);
      const message = await explainWithTransport(raw);
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

  /**
   * The current HEAD, or null when it can't be read.
   *
   * Used as the "did the pull actually bring anything" signal: `git_pull`
   * returns a status, not a changed-file list, and reloading every note
   * preview after a pull that fast-forwarded nothing is the single most
   * expensive thing the app can do — it runs 1.5s after every captured page.
   */
  const headCommitId = async (): Promise<string | null> => {
    try {
      const [head] = await core.getGitHistory({ limit: 1 });
      return head?.id ?? null;
    } catch {
      return null;
    }
  };

  const scheduleAutoSyncAttempt = (reason: string, delayMs: number) => {
    if (autoSyncTimer) {
      clearTimeout(autoSyncTimer);
    }
    logSync(`auto: scheduled after ${reason} in ${delayMs}ms`);
    autoSyncTimer = setTimeout(() => {
      autoSyncTimer = null;
      if (!savedGitConnection()) {
        logSync(`auto: skipped ${reason}; no saved remote`);
        return;
      }
      if (get().action !== "idle") {
        logSync(`auto: delayed ${reason}; ${get().action} is running`);
        scheduleAutoSyncAttempt(reason, AUTO_SYNC_BUSY_RETRY_MS);
        return;
      }
      logSync(`auto: starting after ${reason}`);
      set({ autoSyncState: "syncing" });
      void get()
        .syncNow()
        .then(() => {
          autoSyncFailureCount = 0;
          set({ autoSyncState: "synced", lastAutoSyncedAt: Date.now() });
        })
        .catch((error) => {
          autoSyncFailureCount += 1;
          const retryMs = autoSyncRetryDelayMs(autoSyncFailureCount);
          logSync(
            `auto: ${reason} failed silently - ${getErrorMessage(error)}; retry in ${retryMs}ms`
          );
          set({
            autoSyncState: "waiting_for_computer",
            error: null,
            hint: null,
          });
          scheduleAutoSyncAttempt("computer unavailable", retryMs);
        });
    }, Math.max(0, delayMs));
  };

  return {
    status: null,
    history: [],
    action: "idle",
    progress: null,
    error: null,
    hint: null,
    autoSyncState: null,
    lastAutoSyncedAt: null,
    audioArchiveState: null,
    irohStatus: null,
    pendingLink: null,

    setPendingLink: (link) => set({ pendingLink: link }),

    refreshIrohStatus: async () => {
      const connection = savedGitConnection();
      if (!connection?.irohTicket || !connection.remote_url) {
        set({ irohStatus: null });
        return;
      }
      try {
        set({ irohStatus: await core.getIrohClientStatus(connection.remote_url) });
      } catch (error) {
        logSync(`iroh: status unavailable - ${getErrorMessage(error)}`);
      }
    },

    refresh: () => run("refresh", () => core.getGitStatus()),

    connect: async (args) => {
      await core.setMobileAudioGitExclusion(false);
      await run("connect", () => core.connectGitRepo(args));
    },

    connectFromLink: async (link) => {
      requireIdle("qr connect");
      await run("connect", async () => {
        const settingsStore = useSettingsStore.getState();
        const profile = activeProfile(settingsStore.snapshot);
        let pairingRemote = link.remote;
        if (link.irohTicket) {
          // Pairing the direct connection can report that audio transfer was
          // refused while the tunnel itself is perfectly healthy. That is a
          // partial result, not a reason to abandon the whole QR setup.
          const proxy = await core.startIrohSyncClient({
            ticket: link.irohTicket,
            remote_url: link.remote,
          });
          set({ irohStatus: proxy });
          pairingRemote = proxy.local_remote_url;
          if (!proxy.paired) {
            logSync(`qr: tunnel up but audio transfer not paired - ${proxy.pair_error ?? "unknown"}`);
          }
        }
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
        await applyAudioGitExclusionFast(
          link.irohTicket
            ? {
                remote_url: link.remote,
                branch: link.branch ?? null,
                username: null,
                password: null,
                irohTicket: link.irohTicket,
              }
            : null
        );
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
      if (link.irohTicket) {
        archiveAudioBestEffort({
          remote_url: link.remote,
          branch: link.branch ?? null,
          username: null,
          password: null,
          irohTicket: link.irohTicket,
        });
      }
    },

    pull: async () => {
      if (isBusy("pull")) {
        return;
      }
      const headBefore = await headCommitId();
      await run("pull", async () => {
        const savedConnection = savedGitConnection();
        const connection = await prepareIrohConnection(savedConnection);
        await applyAudioGitExclusionFast(savedConnection);
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
      // Remote edits may have changed the notes on disk — but only if the
      // pull moved HEAD. Refreshing unconditionally re-read and re-decrypted
      // every note in the root after every captured page.
      const headAfter = await headCommitId();
      if (headBefore === null || headAfter === null || headAfter !== headBefore) {
        await useNotesStore.getState().refresh();
        logSync("pull: notes refreshed after remote changes");
      } else {
        logSync("pull: nothing arrived; notes left untouched");
      }
      await core
        .pruneMobileAudioCache()
        .then((prune) => {
          if (prune.evicted > 0) {
            logSync(`audio cache: evicted ${prune.evicted} verified week-old recording(s)`);
          }
        })
        .catch((error) => {
          logSync(`audio cache: prune skipped - ${getErrorMessage(error)}`);
        });
    },

    syncNow: async () => {
      if (isBusy("sync now")) {
        return;
      }
      logSync("sync now: starting pull then push");
      set({ autoSyncState: "syncing" });
      try {
        await get().pull();
        logSync("sync now: pull complete; starting push");
        await get().push();
        autoSyncFailureCount = 0;
        set({ autoSyncState: "synced", lastAutoSyncedAt: Date.now() });
      } catch (error) {
        set({ autoSyncState: "waiting_for_computer" });
        throw error;
      }
    },

    scheduleAutoSync: (reason, delayMs = AUTO_SYNC_DELAY_MS) => {
      autoSyncFailureCount = 0;
      if (saveReasonHasLocalChanges(reason)) {
        set({ autoSyncState: "saved_locally" });
      }
      scheduleAutoSyncAttempt(reason, delayMs);
    },

    push: async (message) => {
      if (isBusy("push")) {
        return;
      }
      const savedConnection = savedGitConnection();
      await run("push", async () => {
        const connection = await prepareIrohConnection(savedConnection);
        await applyAudioGitExclusionFast(savedConnection);
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
      // Notes are on the computer now — phase two (recordings) runs in the
      // background and never re-blocks this push or the "synced" state.
      archiveAudioBestEffort(savedConnection);
    },
  };
});
