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
    void refreshGitStatus();
    void refreshGitHistory();
  }, [refreshGitHistory, refreshGitStatus]);

  const syncHint = useMemo(() => getSyncHint(gitSyncError), [gitSyncError]);
  const lastSuccessfulSyncAt = syncSettings.lastSuccessfulSyncAt
    ? new Date(syncSettings.lastSuccessfulSyncAt).toLocaleString()
    : null;
  const visibleCommits = gitCommitHistory.slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Sync</h2>
      </div>

      <div className="space-y-4">
        <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
          <div className="overflow-hidden rounded-md border border-border/70">
            <div className="flex items-center justify-between gap-4 border-b border-border/70 px-3 py-2 text-sm">
              <span>Status</span>
              <code className="text-xs">{gitStatus?.repo_initialized ? "Connected" : "Not connected"}</code>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-border/70 px-3 py-2 text-sm">
              <span>Branch</span>
              <code className="text-xs">{gitStatus?.current_branch || syncSettings.gitBranch || "-"}</code>
            </div>
            {gitStatus && (gitStatus.ahead > 0 || gitStatus.behind > 0) ? (
              <div className="flex items-center justify-between gap-4 border-b border-border/70 px-3 py-2 text-sm">
                <span>Ahead / behind</span>
                <code className="text-xs">{gitStatus.ahead} / {gitStatus.behind}</code>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
              <span>Last sync</span>
              <code className="text-xs">{lastSuccessfulSyncAt ?? "Never"}</code>
            </div>
          </div>

          {gitSyncError ? (
            <p className="text-xs text-destructive">{gitSyncError}</p>
          ) : null}
          {syncHint ? <p className="text-xs text-muted-foreground">{syncHint}</p> : null}

          <div className="flex flex-wrap gap-2">
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
          <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
            <h3 className="text-sm font-semibold text-foreground">Recent commits</h3>
            {gitHistoryError ? (
              <p className="text-xs text-destructive">{gitHistoryError}</p>
            ) : null}
            <div className="overflow-hidden rounded-md border border-border/70">
              {visibleCommits.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>
              ) : (
                visibleCommits.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2.5 last:border-b-0"
                  >
                    <span className="grid min-w-0 gap-1">
                      <span className="text-sm font-medium text-foreground">
                        {formatCommitSummaryForApp(item.summary)}
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <code>{item.short_id}</code>
                        <span>{formatGitCommitTime(item.authored_ms)}</span>
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatGitCommitStateLabel(item.sync_state)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
