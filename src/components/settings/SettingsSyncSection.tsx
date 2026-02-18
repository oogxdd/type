import { Button } from "../ui/button";
import { useSettingsData } from "../../hooks/useSettingsData";
import { useSessions } from "../../contexts/SessionsContext";
import { useGitSync } from "../../contexts/GitSyncContext";
import { useNotesTree } from "../../contexts/NotesTreeContext";

export function SettingsSyncSection() {
  const { syncSettings, updateSyncSettings } = useSessions();
  const {
    gitStatus,
    gitSyncAction,
    gitSyncError,
    gitSyncBusy,
    refreshGitStatus,
    connectGitRepo,
    gitPull,
    gitPush,
  } = useGitSync();
  const { refreshTree } = useNotesTree();
  const { canPull, canPush, canConnect, syncActionLabel } = useSettingsData();

  return (
    <>
      <h2 className="settings-detail-title">Sync</h2>
      <p className="settings-detail-text">
        Git-based sync. Your notes stay local and can be pushed/pulled to a remote repo.
      </p>
      <label className="settings-control">
        <span>Remote repository URL</span>
        <input
          type="text"
          value={syncSettings.gitRemoteUrl}
          onChange={(event) => updateSyncSettings({ gitRemoteUrl: event.target.value })}
          placeholder="https://github.com/you/notes.git"
        />
      </label>
      <label className="settings-control">
        <span>Branch</span>
        <input
          type="text"
          value={syncSettings.gitBranch}
          onChange={(event) => updateSyncSettings({ gitBranch: event.target.value })}
          placeholder="main"
        />
      </label>
      <label className="settings-control">
        <span>Commit message</span>
        <input
          type="text"
          value={syncSettings.gitCommitMessage}
          onChange={(event) => updateSyncSettings({ gitCommitMessage: event.target.value })}
          placeholder="Sync notes"
        />
      </label>
      <label className="settings-control">
        <span>Git username (optional, for HTTPS auth)</span>
        <input
          type="text"
          value={syncSettings.gitUsername}
          onChange={(event) => updateSyncSettings({ gitUsername: event.target.value })}
          placeholder="your-github-username"
        />
      </label>
      <label className="settings-control">
        <span>Git token/password (optional)</span>
        <input
          type="password"
          value={syncSettings.gitPassword}
          onChange={(event) => updateSyncSettings({ gitPassword: event.target.value })}
          placeholder="Personal access token"
        />
      </label>
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
          <code>
            {gitStatus ? `${gitStatus.ahead} ahead / ${gitStatus.behind} behind` : "-"}
          </code>
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
      <label className="settings-control">
        <span>Recommended flow</span>
        <span className="settings-inline-help">
          Desktop and iOS point to the same repo and branch. Pull before editing, push after.
        </span>
      </label>
      <div className="settings-action-row">
        <Button variant="outline" size="sm" type="button" onClick={() => void refreshGitStatus()} disabled={gitSyncBusy}>
          {gitSyncAction === "refresh" ? "Refreshing..." : "Refresh status"}
        </Button>
        <Button size="sm" type="button" onClick={() => void connectGitRepo()} disabled={!canConnect}>
          {gitSyncAction === "connect" ? "Connecting..." : "Connect repo"}
        </Button>
        <Button variant="secondary" size="sm" type="button" onClick={() => void gitPull({ onAfterPull: () => refreshTree() })} disabled={!canPull}>
          {gitSyncAction === "pull" ? "Pulling..." : "Pull"}
        </Button>
        <Button variant="secondary" size="sm" type="button" onClick={() => void gitPush()} disabled={!canPush}>
          {gitSyncAction === "push" ? "Pushing..." : "Push"}
        </Button>
      </div>
    </>
  );
}
