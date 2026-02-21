import { useEffect, useState } from "react";
import {
  formatCommitSummaryForApp,
  formatGitCommitStateLabel,
  formatGitCommitTime,
  getSyncHint,
} from "../../../utils/format";
import { useSettingsData } from "../../../hooks/useSettingsData";
import { useProfiles } from "../../../contexts/ProfilesContext";
import { useGitSync } from "../../../contexts/GitSyncContext";
import { useNotesTree } from "../../../contexts/NotesTreeContext";
import { getOtaAutoCheckEnabled, setOtaAutoCheckEnabled } from "../../../utils/storage";
import { ChoiceRow, Group, StatRow } from "./SettingsHelpers";

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
  } = useGitSync();
  const { refreshTree } = useNotesTree();
  const { canPull, canPush, canConnect } = useSettingsData();
  const [otaAutoCheckEnabled, setLocalOtaAutoCheckEnabled] = useState(() => getOtaAutoCheckEnabled());

  const lastSuccessfulSyncAt = syncSettings.lastSuccessfulSyncAt
    ? new Date(syncSettings.lastSuccessfulSyncAt).toLocaleString()
    : null;

  const syncHint = getSyncHint(gitSyncError);
  const visibleCommits = gitCommitHistory.slice(0, 8);

  useEffect(() => {
    void refreshGitHistory();
  }, [refreshGitHistory]);

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

      <Group title="OTA updates (iOS)">
        <ChoiceRow
          label="Check for updates on launch"
          subtitle="Fetches manifest.json before startup."
          selected={otaAutoCheckEnabled}
          onClick={() => {
            setLocalOtaAutoCheckEnabled(true);
            setOtaAutoCheckEnabled(true);
          }}
        />
        <ChoiceRow
          label="Always use bundled version"
          subtitle="Skips OTA network check for faster startup."
          selected={!otaAutoCheckEnabled}
          onClick={() => {
            setLocalOtaAutoCheckEnabled(false);
            setOtaAutoCheckEnabled(false);
          }}
        />
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
          {!gitStatus?.repo_initialized ? (
            <button
              type="button"
              className="mobile-primary-btn"
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
