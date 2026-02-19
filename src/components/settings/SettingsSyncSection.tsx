import { useEffect, useMemo, useState } from "react";
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
  const { canPull, canPush, canConnect, syncActionLabel } = useSettingsData();

  const [expandedCommitIds, setExpandedCommitIds] = useState<Record<string, true>>({});

  useEffect(() => {
    void refreshGitHistory();
  }, [refreshGitHistory]);

  useEffect(() => {
    if (gitCommitHistory.length === 0) {
      setExpandedCommitIds({});
      return;
    }
    const validIds = new Set(gitCommitHistory.map((item) => item.id));
    setExpandedCommitIds((previous) => {
      const next: Record<string, true> = {};
      Object.keys(previous).forEach((id) => {
        if (validIds.has(id)) {
          next[id] = true;
        }
      });
      if (Object.keys(next).length === 0) {
        next[gitCommitHistory[0].id] = true;
      }
      return next;
    });
  }, [gitCommitHistory]);

  const syncHint = useMemo(() => getSyncHint(gitSyncError), [gitSyncError]);
  const lastSuccessfulSyncAt = syncSettings.lastSuccessfulSyncAt
    ? new Date(syncSettings.lastSuccessfulSyncAt).toLocaleString()
    : null;

  const toggleCommitExpanded = (id: string) => {
    setExpandedCommitIds((previous) => {
      const next = { ...previous };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = true;
      }
      return next;
    });
  };

  return (
    <>
      <div className="settings-detail-hero">
        <h2 className="settings-detail-title">Sync</h2>
      </div>

      <div className="settings-section-stack">
        <section className="settings-group">
          <h3 className="settings-group-title">Status</h3>
          <div className="settings-info-grid">
            <div className="settings-info-row">
              <span>Repository</span>
              <code>{gitStatus?.repo_initialized ? "Connected" : "Not connected"}</code>
            </div>
            <div className="settings-info-row">
              <span>Branch</span>
              <code>{gitStatus?.current_branch || syncSettings.gitBranch || "-"}</code>
            </div>
            <div className="settings-info-row">
              <span>Ahead / behind</span>
              <code>{gitStatus ? `${gitStatus.ahead} / ${gitStatus.behind}` : "-"}</code>
            </div>
            <div className="settings-info-row">
              <span>Last sync</span>
              <code>{lastSuccessfulSyncAt ?? "Never"}</code>
            </div>
            <div className="settings-info-row">
              <span>Next action</span>
              <code>{syncActionLabel}</code>
            </div>
          </div>

          {gitSyncError ? (
            <p className="settings-warning-text settings-inline-warning">{gitSyncError}</p>
          ) : null}
          {syncHint ? <p className="settings-inline-help">{syncHint}</p> : null}

          <div className="settings-action-row">
            <Button
              size="sm"
              type="button"
              onClick={() => void connectGitRepo()}
              disabled={!canConnect}
            >
              {gitSyncAction === "connect" ? "Connecting..." : "Connect repo"}
            </Button>
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

        <section className="settings-group">
          <h3 className="settings-group-title">Recent commits</h3>
          {gitHistoryError ? (
            <p className="settings-warning-text settings-inline-warning">{gitHistoryError}</p>
          ) : null}
          <div className="settings-commit-list">
            {gitCommitHistory.length === 0 ? (
              <div className="settings-commit-row empty">
                {gitHistoryBusy ? "Loading commits..." : "No commits yet."}
              </div>
            ) : (
              gitCommitHistory.map((item) => {
                const expanded = Boolean(expandedCommitIds[item.id]);
                return (
                  <div
                    key={item.id}
                    className={`settings-commit-row-wrap${expanded ? " expanded" : ""}`}
                  >
                    <button
                      type="button"
                      className={`settings-commit-row${expanded ? " active" : ""}`}
                      onClick={() => toggleCommitExpanded(item.id)}
                      aria-expanded={expanded}
                    >
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
                    </button>
                    {expanded ? (
                      <div className="settings-commit-details">
                        <div className="settings-commit-details-grid">
                          <div className="settings-info-row">
                            <span>Commit</span>
                            <code>{item.short_id}</code>
                          </div>
                          <div className="settings-info-row">
                            <span>Author</span>
                            <code>{item.author}</code>
                          </div>
                          <div className="settings-info-row">
                            <span>When</span>
                            <code>{formatGitCommitTime(item.authored_ms)}</code>
                          </div>
                          <div className="settings-info-row">
                            <span>State</span>
                            <code>{formatGitCommitStateLabel(item.sync_state)}</code>
                          </div>
                          <div className="settings-info-row">
                            <span>Position</span>
                            <code>{item.is_head ? "Latest" : "History"}</code>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </>
  );
}
