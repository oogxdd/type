import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { useGitSync } from "../../contexts/GitSyncContext";
import { useNotesTree } from "../../contexts/NotesTreeContext";
import { useProfiles } from "../../contexts/ProfilesContext";
import { useSettingsData } from "../../hooks/useSettingsData";
import {
  formatCommitSummaryForApp,
  formatGitCommitStateLabel,
  formatGitCommitTime,
  getSyncHint,
} from "../../utils/format";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function SettingsGeneralSection() {
  const {
    profiles,
    activeProfileId,
    activeProfileNotesRoot,
    profilesBusy,
    profilesError,
    switchProfile,
    createProfile,
    setProfileNotesRoot,
    syncSettings,
    updateSyncSettings,
  } = useProfiles();
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
  const [notesRootInput, setNotesRootInput] = useState("");

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [activeProfileId, profiles]
  );

  useEffect(() => {
    setNotesRootInput(activeProfile?.notes_root ?? "");
  }, [activeProfile?.notes_root]);

  useEffect(() => {
    void refreshGitHistory();
  }, [refreshGitHistory]);

  const chooseWorkingDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: notesRootInput || activeProfileNotesRoot || undefined,
        title: "Select profile notes folder",
      });
      if (typeof selected === "string" && selected.trim()) {
        setNotesRootInput(selected);
      }
    } catch (error) {
      console.error("Failed to pick working directory", error);
    }
  };

  const lastSuccessfulSyncAt = syncSettings.lastSuccessfulSyncAt
    ? new Date(syncSettings.lastSuccessfulSyncAt).toLocaleString()
    : null;

  const syncHint = useMemo(() => getSyncHint(gitSyncError), [gitSyncError]);
  const visibleCommits = gitCommitHistory.slice(0, 8);

  return (
    <>
      <div className="settings-detail-hero">
        <h2 className="settings-detail-title">Profiles</h2>
        <p className="settings-detail-text">Each profile has its own notes folder and git setup.</p>
      </div>
      <div className="settings-section-stack">
        <section className="settings-group">
          <h3 className="settings-group-title">Profile</h3>
          <label className="settings-control">
            <span>Active profile</span>
            <div className="settings-inline-row">
              <select
                value={activeProfileId ?? ""}
                onChange={(event) => void switchProfile(event.target.value)}
                disabled={profilesBusy || profiles.length === 0}
              >
                {profiles.length === 0 ? <option value="">No profiles</option> : null}
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void createProfile()}
                disabled={profilesBusy}
              >
                {profilesBusy ? "Working..." : "New profile"}
              </Button>
            </div>
          </label>
          {profilesError ? (
            <p className="settings-warning-text settings-inline-warning">{profilesError}</p>
          ) : null}
          <div className="settings-info-grid">
            <div className="settings-info-row">
              <span>Current</span>
              <code>{activeProfile?.name ?? "-"}</code>
            </div>
          </div>
        </section>

        <section className="settings-group">
          <h3 className="settings-group-title">Notes folder</h3>
          <div className="settings-control">
            <Label htmlFor="profile-working-directory">Folder path</Label>
            <div className="settings-inline-row">
              <Input
                id="profile-working-directory"
                type="text"
                value={notesRootInput}
                onChange={(event) => setNotesRootInput(event.target.value)}
                placeholder="/Users/you/Documents/type"
                disabled={!activeProfileId || profilesBusy}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!activeProfileId || profilesBusy}
                onClick={() => void chooseWorkingDirectory()}
              >
                Choose folder
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!activeProfileId || profilesBusy || !notesRootInput.trim()}
                onClick={() => {
                  if (!activeProfileId) {
                    return;
                  }
                  void setProfileNotesRoot(activeProfileId, notesRootInput);
                }}
              >
                Apply
              </Button>
            </div>
            <span className="settings-inline-help">Absolute path only.</span>
            {activeProfileNotesRoot ? <code>{activeProfileNotesRoot}</code> : null}
          </div>
        </section>

        <section className="settings-group">
          <h3 className="settings-group-title">Git setup</h3>
          <label className="settings-control">
            <span>Remote URL</span>
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
              onChange={(event) => updateSyncSettings({ gitCommitMessage: event.target.value })}
              placeholder="Sync notes"
            />
          </label>
          <label className="settings-control">
            <span>Username (optional)</span>
            <Input
              type="text"
              value={syncSettings.gitUsername}
              onChange={(event) => updateSyncSettings({ gitUsername: event.target.value })}
              placeholder="Git username"
              autoCapitalize="off"
              autoCorrect="off"
            />
          </label>
          <label className="settings-control">
            <span>Token / password (optional)</span>
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

        <section className="settings-group">
          <h3 className="settings-group-title">Sync</h3>
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
            {visibleCommits.length === 0 ? (
              <div className="settings-commit-row empty">
                {gitHistoryBusy ? "Loading commits..." : "No commits yet."}
              </div>
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
      </div>
    </>
  );
}
