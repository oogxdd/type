import { useCallback, useEffect, useState } from "react";
import {
  formatCommitSummaryForApp,
  formatGitCommitStateLabel,
  formatGitCommitTime,
  getSyncHint,
} from "@/utils/format";
import * as gitApi from "@/data/git-api";
import type { DiscoveredServer } from "@/types";
import { useSettingsData } from "@/features/settings/use-settings-data";
import { useProfiles } from "@/contexts/profiles-context";
import { useGitSync } from "@/contexts/git-sync-context";
import { useNotesTree } from "@/features/notes/hooks/notes-tree-context";
import { ChoiceRow, Group, StatRow } from "./helpers";

export function MobileSyncSection() {
  const { syncSettings } = useProfiles();
  const {
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
  } = useGitSync();
  const { refreshTree } = useNotesTree();
  const { canPull, canPush, canConnect, canSync } = useSettingsData();

  const lastSuccessfulSyncAt = syncSettings.lastSuccessfulSyncAt
    ? new Date(syncSettings.lastSuccessfulSyncAt).toLocaleString()
    : null;

  const syncHint = getSyncHint(gitSyncError);
  const visibleCommits = gitCommitHistory.slice(0, 8);

  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredServer[]>([]);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [didDiscover, setDidDiscover] = useState(false);

  const handleDiscover = useCallback(async () => {
    setDiscovering(true);
    setDiscoverError(null);
    try {
      setDiscovered(await gitApi.discoverLocalSyncServers(2500));
      setDidDiscover(true);
    } catch (error) {
      setDiscoverError(error instanceof Error ? error.message : String(error));
    } finally {
      setDiscovering(false);
    }
  }, []);

  const handlePickServer = useCallback(
    (server: DiscoveredServer) => {
      void syncNow({
        remote: server.git_url,
        branch: server.branch,
        onAfterPull: () => refreshTree(),
      });
    },
    [syncNow, refreshTree]
  );

  useEffect(() => {
    void refreshGitStatus();
    void refreshGitHistory();
  }, [refreshGitHistory, refreshGitStatus]);

  return (
    <>
      <Group title="Status">
        <StatRow
          label="Repository"
          value={gitStatus?.repo_initialized ? "Connected" : "Not connected"}
        />
        <StatRow label="Branch" value={gitStatus?.current_branch || syncSettings.gitBranch || "-"} />
        {gitStatus && (gitStatus.ahead > 0 || gitStatus.behind > 0) ? (
          <StatRow
            label="Ahead / behind"
            value={`${gitStatus.ahead} / ${gitStatus.behind}`}
          />
        ) : null}
        <StatRow label="Last sync" value={lastSuccessfulSyncAt ?? "Never"} />
      </Group>

      {gitSyncError ? (
        <section className="mobile-sync-error" role="alert">
          <strong>Sync error</strong>
          <p>{gitSyncError}</p>
          {syncHint ? <p className="hint">{syncHint}</p> : null}
        </section>
      ) : null}

      <Group title="Actions">
        <div className="mobile-native-actions single">
          <button
            type="button"
            className="mobile-primary-btn"
            onClick={() => void syncNow({ onAfterPull: () => refreshTree() })}
            disabled={!canSync}
          >
            {gitSyncAction === "sync" ? "Syncing..." : "Sync now"}
          </button>
          {!gitStatus?.repo_initialized ? (
            <button
              type="button"
              className="mobile-secondary-btn"
              onClick={() => void connectGitRepo()}
              disabled={!canConnect}
            >
              {gitSyncAction === "connect" ? "Connecting..." : "Connect"}
            </button>
          ) : null}
          <button
            type="button"
            className="mobile-secondary-btn"
            onClick={() => void gitPull({ onAfterPull: () => refreshTree() })}
            disabled={!canPull}
          >
            {gitSyncAction === "pull" ? "Pulling..." : "Pull"}
          </button>
          <button
            type="button"
            className="mobile-secondary-btn"
            onClick={() => void gitPush()}
            disabled={!canPush}
          >
            {gitSyncAction === "push" ? "Pushing..." : "Push"}
          </button>
          <button
            type="button"
            className="mobile-secondary-btn"
            onClick={() => {
              void refreshGitStatus();
              void refreshGitHistory();
            }}
            disabled={gitSyncBusy || gitHistoryBusy}
          >
            {gitSyncAction === "refresh" || gitHistoryBusy ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </Group>

      <Group title="Find on local network">
        <p className="mobile-native-note">
          Discover a computer running the sync server on this Wi-Fi or your hotspot — no URL to
          type. Tap one to sync.
        </p>
        <div className="mobile-native-actions single">
          <button
            type="button"
            className="mobile-secondary-btn"
            onClick={() => void handleDiscover()}
            disabled={discovering || gitSyncBusy}
          >
            {discovering ? "Searching..." : "Find on local network"}
          </button>
        </div>
        {discovered.map((server) => (
          <ChoiceRow
            key={server.git_url}
            label={server.name}
            subtitle={server.git_url}
            selected={syncSettings.gitRemoteUrl === server.git_url}
            onClick={() => handlePickServer(server)}
          />
        ))}
        {discoverError ? <p className="mobile-native-note">{discoverError}</p> : null}
        {didDiscover && !discovering && discovered.length === 0 && !discoverError ? (
          <p className="mobile-native-note">
            No servers found. On the computer, tap “Start server” in Settings → Sync, and make sure
            you allowed local-network access on this phone.
          </p>
        ) : null}
      </Group>

      {visibleCommits.length > 0 || gitHistoryBusy ? (
        <Group title="Recent commits">
          {gitHistoryError ? (
            <p className="mobile-native-note">{gitHistoryError}</p>
          ) : null}
          {visibleCommits.length === 0 ? (
            <p className="mobile-native-note">Loading...</p>
          ) : (
            visibleCommits.map((item) => (
              <div key={item.id} className="mobile-native-row stat">
                <span className="mobile-native-row-main">
                  <span className="mobile-native-row-label">{formatCommitSummaryForApp(item.summary)}</span>
                  <span className="mobile-native-row-sub">
                    {item.short_id} · {formatGitCommitTime(item.authored_ms)}
                  </span>
                </span>
                <span className="mobile-native-row-value">{formatGitCommitStateLabel(item.sync_state)}</span>
              </div>
            ))
          )}
        </Group>
      ) : null}
    </>
  );
}
