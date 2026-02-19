import { useEffect, useMemo, useState } from "react";
import { useSettingsData } from "../../../hooks/useSettingsData";
import { useGitSync } from "../../../contexts/GitSyncContext";
import { useNotesTree } from "../../../contexts/NotesTreeContext";
import { useProfiles } from "../../../contexts/ProfilesContext";
import {
  formatCommitSummaryForApp,
  formatGitCommitStateLabel,
  formatGitCommitTime,
  getSyncHint,
} from "../../../utils/format";
import { Group, ChoiceRow, InputRow, StatRow } from "./SettingsHelpers";

export function MobileGeneralSection() {
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

  const lastSuccessfulSyncAt = syncSettings.lastSuccessfulSyncAt
    ? new Date(syncSettings.lastSuccessfulSyncAt).toLocaleString()
    : null;
  const visibleCommits = gitCommitHistory.slice(0, 8);
  const syncHint = getSyncHint(gitSyncError);

  return (
    <>
      <Group title="Profile">
        <StatRow label="Current" value={activeProfile?.name ?? "No profile"} />
        <div className="mobile-native-actions single">
          <button
            type="button"
            className="mobile-primary-btn"
            onClick={() => void createProfile()}
            disabled={profilesBusy}
          >
            {profilesBusy ? "Working..." : "New profile"}
          </button>
        </div>
        {profilesError ? <p className="mobile-native-note">{profilesError}</p> : null}
      </Group>

      <Group title="Switch profile">
        {profiles.length === 0 ? (
          <p className="mobile-native-note">No profiles available.</p>
        ) : (
          profiles.map((profile) => (
            <ChoiceRow
              key={profile.id}
              label={profile.name}
              selected={activeProfileId === profile.id}
              onClick={() => void switchProfile(profile.id)}
            />
          ))
        )}
      </Group>

      <Group title="Notes folder">
        <StatRow label="Current path" value={activeProfileNotesRoot || "-"} />
        <InputRow
          label="New path"
          value={notesRootInput}
          onChange={setNotesRootInput}
          placeholder="/Users/you/Documents/type"
          disabled={!activeProfileId || profilesBusy}
        />
        <div className="mobile-native-actions single">
          <button
            type="button"
            className="mobile-secondary-btn"
            disabled={!activeProfileId || profilesBusy || !notesRootInput.trim()}
            onClick={() => {
              if (!activeProfileId) {
                return;
              }
              void setProfileNotesRoot(activeProfileId, notesRootInput);
            }}
          >
            Apply path
          </button>
        </div>
      </Group>

      <Group title="Git setup">
        <InputRow
          label="Remote URL"
          value={syncSettings.gitRemoteUrl}
          onChange={(value) => updateSyncSettings({ gitRemoteUrl: value })}
          placeholder="https://github.com/you/notes.git"
        />
        <InputRow
          label="Branch"
          value={syncSettings.gitBranch}
          onChange={(value) => updateSyncSettings({ gitBranch: value })}
          placeholder="main"
        />
        <InputRow
          label="Commit message"
          value={syncSettings.gitCommitMessage}
          onChange={(value) => updateSyncSettings({ gitCommitMessage: value })}
          placeholder="Sync notes"
        />
        <InputRow
          label="Username"
          value={syncSettings.gitUsername}
          onChange={(value) => updateSyncSettings({ gitUsername: value })}
          placeholder="Git username"
        />
        <InputRow
          label="Token / password"
          value={syncSettings.gitPassword}
          onChange={(value) => updateSyncSettings({ gitPassword: value })}
          placeholder="Personal access token"
          password
        />
      </Group>

      <Group title="Sync">
        <StatRow
          label="Repository"
          value={gitStatus?.repo_initialized ? "Connected" : "Not connected"}
        />
        <StatRow label="Branch" value={gitStatus?.current_branch || syncSettings.gitBranch || "-"} />
        <StatRow
          label="Ahead / behind"
          value={gitStatus ? `${gitStatus.ahead} / ${gitStatus.behind}` : "-"}
        />
        <StatRow label="Last sync" value={lastSuccessfulSyncAt ?? "Never"} />
        <StatRow label="Next action" value={syncActionLabel} />

        <div className="mobile-native-actions single">
          <button
            type="button"
            className="mobile-primary-btn"
            onClick={() => void connectGitRepo()}
            disabled={!canConnect}
          >
            {gitSyncAction === "connect" ? "Connecting..." : "Connect repo"}
          </button>
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

      <Group title="Recent commits">
        {gitHistoryError ? <p className="mobile-native-note">{gitHistoryError}</p> : null}
        {!gitHistoryError && visibleCommits.length === 0 && !gitHistoryBusy ? (
          <p className="mobile-native-note">No commits yet.</p>
        ) : null}
        {visibleCommits.map((item) => (
          <div key={item.id} className="mobile-native-row stat">
            <span className="mobile-native-row-main">
              <span className="mobile-native-row-label">{formatCommitSummaryForApp(item.summary)}</span>
              <span className="mobile-native-row-sub">
                {item.short_id} · {formatGitCommitTime(item.authored_ms)}
              </span>
            </span>
            <span className="mobile-native-row-value">{formatGitCommitStateLabel(item.sync_state)}</span>
          </div>
        ))}
      </Group>

      {gitSyncError ? (
        <section className="mobile-sync-error" role="alert">
          <strong>Sync error</strong>
          <p>{gitSyncError}</p>
          {syncHint ? <p className="hint">{syncHint}</p> : null}
        </section>
      ) : null}
    </>
  );
}
