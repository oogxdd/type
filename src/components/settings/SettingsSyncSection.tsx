import { useEffect, useMemo, useState } from "react";
import { useNotesTree } from "../../contexts/NotesTreeContext";
import { useGitSync } from "../../contexts/GitSyncContext";
import { useSessions } from "../../contexts/SessionsContext";
import { useSettingsData } from "../../hooks/useSettingsData";
import {
  formatCommitSummaryForApp,
  formatGitCommitStateLabel,
  formatGitCommitTime,
  getSyncHint,
} from "../../utils/format";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

export function SettingsSyncSection() {
  const { syncSettings, updateSyncSettings } = useSessions();
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

  const [activeTab, setActiveTab] = useState<"setup" | "activity">("activity");
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
        <p className="settings-detail-text">Git sync for this session.</p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "setup" | "activity")}
        className="settings-sync-tabs"
      >
        <TabsList variant="line" className="settings-sync-tabs-list">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="settings-sync-tab-content">
          <div className="settings-section-stack">
            <section className="settings-group">
              <h3 className="settings-group-title">Repository</h3>
              <label className="settings-control">
                <span>Remote repository URL</span>
                <Input
                  type="text"
                  value={syncSettings.gitRemoteUrl}
                  onChange={(event) => updateSyncSettings({ gitRemoteUrl: event.target.value })}
                  placeholder="https://github.com/you/notes.git"
                />
              </label>
              <label className="settings-control">
                <span>Branch</span>
                <Input
                  type="text"
                  value={syncSettings.gitBranch}
                  onChange={(event) => updateSyncSettings({ gitBranch: event.target.value })}
                  placeholder="main"
                />
              </label>
              <label className="settings-control">
                <span>Commit message</span>
                <Input
                  type="text"
                  value={syncSettings.gitCommitMessage}
                  onChange={(event) =>
                    updateSyncSettings({ gitCommitMessage: event.target.value })
                  }
                  placeholder="Sync notes"
                />
              </label>
            </section>

            <section className="settings-group">
              <h3 className="settings-group-title">Credentials</h3>
              <label className="settings-control">
                <span>Git username (optional)</span>
                <Input
                  type="text"
                  value={syncSettings.gitUsername}
                  onChange={(event) => updateSyncSettings({ gitUsername: event.target.value })}
                  placeholder="your-github-username"
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </label>
              <label className="settings-control">
                <span>Git token/password (optional)</span>
                <Input
                  type="password"
                  value={syncSettings.gitPassword}
                  onChange={(event) => updateSyncSettings({ gitPassword: event.target.value })}
                  placeholder="Personal access token"
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </label>
            </section>
          </div>
        </TabsContent>

        <TabsContent value="activity" className="settings-sync-tab-content">
          <div className="settings-section-stack">
            <section className="settings-group">
              <h3 className="settings-group-title">Status</h3>
              <div className="settings-info-grid">
                <div className="settings-info-row">
                  <span>Git available</span>
                  <code>{gitStatus?.git_available ? "yes" : "no"}</code>
                </div>
                <div className="settings-info-row">
                  <span>Repository</span>
                  <code>{gitStatus?.repo_initialized ? "initialized" : "not initialized"}</code>
                </div>
                <div className="settings-info-row">
                  <span>Current branch</span>
                  <code>{gitStatus?.current_branch ?? "-"}</code>
                </div>
                <div className="settings-info-row">
                  <span>Remote URL</span>
                  <code>{gitStatus?.remote_url ?? "-"}</code>
                </div>
                <div className="settings-info-row">
                  <span>Working tree</span>
                  <code>{gitStatus?.has_uncommitted_changes ? "changes pending" : "clean"}</code>
                </div>
                <div className="settings-info-row">
                  <span>Push status</span>
                  <code>{gitStatus?.push_required ? "ready to push" : "up to date"}</code>
                </div>
                <div className="settings-info-row">
                  <span>Ahead / behind</span>
                  <code>{gitStatus ? `${gitStatus.ahead} ahead / ${gitStatus.behind} behind` : "-"}</code>
                </div>
                <div className="settings-info-row">
                  <span>Sync action</span>
                  <code>{syncActionLabel}</code>
                </div>
                <div className="settings-info-row">
                  <span>Notes root</span>
                  <code>{gitStatus?.notes_root ?? "-"}</code>
                </div>
              </div>

              {gitSyncError ? (
                <p className="settings-warning-text settings-inline-warning">{gitSyncError}</p>
              ) : null}
              {syncHint ? <p className="settings-inline-help">{syncHint}</p> : null}

              <div className="settings-action-row">
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
                  {gitSyncAction === "refresh" || gitHistoryBusy ? "Refreshing..." : "Refresh status"}
                </Button>
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
              </div>
            </section>

            <section className="settings-group">
              <h3 className="settings-group-title">Commits</h3>
              {gitHistoryError ? (
                <p className="settings-warning-text settings-inline-warning">{gitHistoryError}</p>
              ) : null}
              <div className="settings-commit-list">
                {gitCommitHistory.length === 0 ? (
                  <div className="settings-commit-row empty">
                    {gitHistoryBusy ? "Loading commit history..." : "No commits yet."}
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
        </TabsContent>
      </Tabs>
    </>
  );
}
