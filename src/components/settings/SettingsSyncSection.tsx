import { useEffect, useMemo } from "react";
import { useNotesTree } from "../../contexts/NotesTreeContext";
import { useGitSync } from "../../contexts/GitSyncContext";
import { useProfiles } from "../../contexts/ProfilesContext";
import { useSettingsData } from "../../hooks/useSettingsData";
import {
  formatCommitSummaryForApp,
  formatGitCommitStateLabel,
  formatGitCommitTime,
  getSyncHint,
} from "../../utils/format";
import { Button } from "../ui/button";

export function SettingsSyncSection() {
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

  useEffect(() => {
    void refreshGitHistory();
  }, [refreshGitHistory]);

  const syncHint = useMemo(() => getSyncHint(gitSyncError), [gitSyncError]);
  const lastSuccessfulSyncAt = syncSettings.lastSuccessfulSyncAt
    ? new Date(syncSettings.lastSuccessfulSyncAt).toLocaleString()
    : null;
  const visibleCommits = gitCommitHistory.slice(0, 8);

  return (
    <>
      <div className="settings-detail-hero">
        <h2 className="settings-detail-title">Sync</h2>
      </div>

      <div className="settings-section-stack">
        <section className="settings-group">
          <div className="settings-info-grid">
            <div className="settings-info-row">
              <span>Status</span>
              <code>{gitStatus?.repo_initialized ? "Connected" : "Not connected"}</code>
            </div>
            <div className="settings-info-row">
              <span>Branch</span>
              <code>{gitStatus?.current_branch || syncSettings.gitBranch || "-"}</code>
            </div>
            {gitStatus && (gitStatus.ahead > 0 || gitStatus.behind > 0) ? (
              <div className="settings-info-row">
                <span>Ahead / behind</span>
                <code>{gitStatus.ahead} / {gitStatus.behind}</code>
              </div>
            ) : null}
            <div className="settings-info-row">
              <span>Last sync</span>
              <code>{lastSuccessfulSyncAt ?? "Never"}</code>
            </div>
          </div>

          {gitSyncError ? (
            <p className="settings-warning-text settings-inline-warning">{gitSyncError}</p>
          ) : null}
          {syncHint ? <p className="settings-inline-help">{syncHint}</p> : null}

          <div className="settings-action-row">
            {!gitStatus?.repo_initialized ? (
              <Button
                size="sm"
                type="button"
                onClick={() => void connectGitRepo()}
                disabled={!canConnect}
              >
                {gitSyncAction === "connect" ? "Connecting..." : "Connect"}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void gitPull({ onAfterPull: () => refreshTree() })}
              disabled={!canPull}
            >
              {gitSyncAction === "pull" ? "Pulling..." : "Pull"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void gitPush()}
              disabled={!canPush}
            >
              {gitSyncAction === "push" ? "Pushing..." : "Push"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => {
                void refreshGitStatus();
                void refreshGitHistory();
              }}
              disabled={gitSyncBusy || gitHistoryBusy}
            >
              {gitSyncAction === "refresh" || gitHistoryBusy ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </section>

        {visibleCommits.length > 0 || gitHistoryBusy ? (
          <section className="settings-group">
            <h3 className="settings-group-title">Recent commits</h3>
            {gitHistoryError ? (
              <p className="settings-warning-text settings-inline-warning">{gitHistoryError}</p>
            ) : null}
            <div className="settings-commit-list">
              {visibleCommits.length === 0 ? (
                <div className="settings-commit-row empty">Loading...</div>
              ) : (
                visibleCommits.map((item) => (
                  <div key={item.id} className="settings-commit-row">
                    <span className="settings-commit-main">
                      <span className="settings-commit-title">
                        {formatCommitSummaryForApp(item.summary)}
                      </span>
                      <span className="settings-commit-meta">
                        <code>{item.short_id}</code>
                        <span>{formatGitCommitTime(item.authored_ms)}</span>
                      </span>
                    </span>
                    <span className="settings-commit-state">
                      {formatGitCommitStateLabel(item.sync_state)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
