import { useEffect } from "react";
import {
  formatCommitSummaryForApp,
  formatGitCommitStateLabel,
  formatGitCommitTime,
  getSyncHint,
} from "../../../utils/format";
import { useSettingsData } from "../../../hooks/useSettingsData";
import { useSessions } from "../../../contexts/SessionsContext";
import { useGitSync } from "../../../contexts/GitSyncContext";
import { useNotesTree } from "../../../contexts/NotesTreeContext";
import { Group, InputRow, StatRow } from "./SettingsHelpers";

type MobileSyncSectionProps = {
  view: "credentials" | "actions";
};

export function MobileSyncSection({ view }: MobileSyncSectionProps) {
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

  const lastSuccessfulSyncAt = syncSettings.lastSuccessfulSyncAt
    ? new Date(syncSettings.lastSuccessfulSyncAt).toLocaleString()
    : null;

  const syncHint = getSyncHint(gitSyncError);
  const visibleCommits = gitCommitHistory.slice(0, 8);

  useEffect(() => {
    void refreshGitHistory();
  }, [refreshGitHistory]);

  if (view === "credentials") {
    return (
      <>
        <Group title="Repository">
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
        </Group>

        <Group title="Commit">
          <InputRow
            label="Commit message"
            value={syncSettings.gitCommitMessage}
            onChange={(value) => updateSyncSettings({ gitCommitMessage: value })}
            placeholder="Sync notes"
          />
        </Group>

        <Group title="Credentials">
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
      </>
    );
  }

  return (
    <>
      <Group title="Status">
        <StatRow
          label="Repository"
          value={gitStatus?.repo_initialized ? "Connected" : "Not connected"}
        />
        <StatRow label="Last sync" value={lastSuccessfulSyncAt ?? "Never"} />
        <StatRow label="Remote URL" value={gitStatus?.remote_url ?? "-"} />
        <StatRow label="Branch" value={gitStatus?.current_branch || syncSettings.gitBranch || "-"} />
        <StatRow
          label="Ahead / behind"
          value={gitStatus ? `${gitStatus.ahead} / ${gitStatus.behind}` : "-"}
        />
        <StatRow
          label="Working tree"
          value={gitStatus?.has_uncommitted_changes ? "Changes pending" : "Clean"}
        />
        <StatRow label="Push status" value={gitStatus?.push_required ? "Required" : "Up to date"} />
        <StatRow label="Next action" value={syncActionLabel} />
      </Group>

      <Group title="Sync now">
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
            {gitSyncAction === "refresh" || gitHistoryBusy ? "Refreshing..." : "Refresh status"}
          </button>
        </div>
      </Group>

      <Group title="Recent commits">
        {gitHistoryError ? (
          <p className="mobile-native-note">{gitHistoryError}</p>
        ) : null}
        {!gitHistoryError && gitCommitHistory.length === 0 && !gitHistoryBusy ? (
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
