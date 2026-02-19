import { useEffect, useMemo, useState } from "react";
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
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);

  useEffect(() => {
    void refreshGitHistory();
  }, [refreshGitHistory]);

  useEffect(() => {
    if (gitCommitHistory.length === 0) {
      if (selectedCommitId) {
        setSelectedCommitId(null);
      }
      return;
    }
    if (!selectedCommitId || !gitCommitHistory.some((item) => item.id === selectedCommitId)) {
      setSelectedCommitId(gitCommitHistory[0].id);
    }
  }, [gitCommitHistory, selectedCommitId]);

  const selectedCommit = useMemo(() => {
    if (gitCommitHistory.length === 0) {
      return null;
    }
    if (!selectedCommitId) {
      return gitCommitHistory[0];
    }
    return gitCommitHistory.find((item) => item.id === selectedCommitId) ?? gitCommitHistory[0];
  }, [gitCommitHistory, selectedCommitId]);

  return (
    <>
      {view === "credentials" ? (
        <>
          <Group title="Repository">
            <InputRow
              label="Remote URL"
              value={syncSettings.gitRemoteUrl}
              onChange={(v) => updateSyncSettings({ gitRemoteUrl: v })}
              placeholder="https://github.com/you/notes.git"
            />
            <InputRow label="Branch" value={syncSettings.gitBranch} onChange={(v) => updateSyncSettings({ gitBranch: v })} placeholder="main" />
            <InputRow
              label="Commit message"
              value={syncSettings.gitCommitMessage}
              onChange={(v) => updateSyncSettings({ gitCommitMessage: v })}
              placeholder="Sync notes"
            />
          </Group>

          <Group title="Authentication">
            <InputRow
              label="Username"
              value={syncSettings.gitUsername}
              onChange={(v) => updateSyncSettings({ gitUsername: v })}
              placeholder="Git username"
            />
            <InputRow
              label="Token / password"
              value={syncSettings.gitPassword}
              onChange={(v) => updateSyncSettings({ gitPassword: v })}
              placeholder="Personal access token"
              password
            />
          </Group>

          <p className="mobile-native-note">
            Credentials are stored on this device. Use least-privilege tokens.
          </p>
        </>
      ) : (
        <>
          <Group title="Actions">
            <div className="mobile-native-actions">
              <button
                type="button"
                className="mobile-primary-btn"
                onClick={() => void connectGitRepo()}
                disabled={!canConnect}
              >
                {gitSyncAction === "connect" ? "Connecting..." : "Connect repo"}
              </button>
              <button type="button" className="mobile-secondary-btn" onClick={() => void gitPull({ onAfterPull: () => refreshTree() })} disabled={!canPull}>
                {gitSyncAction === "pull" ? "Pulling..." : "Pull"}
              </button>
              <button type="button" className="mobile-secondary-btn" onClick={() => void gitPush()} disabled={!canPush}>
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

          <Group title="Status">
            <StatRow label="Last successful sync" value={lastSuccessfulSyncAt ?? "Never"} />
            <StatRow label="Repository" value={gitStatus?.repo_initialized ? "Connected" : "Not connected"} />
            <StatRow label="Branch" value={gitStatus?.current_branch || syncSettings.gitBranch || "-"} />
            <StatRow label="Remote URL" value={gitStatus?.remote_url ?? "-"} />
            <StatRow
              label="Working tree"
              value={gitStatus?.has_uncommitted_changes ? "Changes pending" : "Clean"}
            />
            <StatRow label="Push status" value={gitStatus?.push_required ? "Ready to push" : "Up to date"} />
            <StatRow
              label="Ahead / behind"
              value={gitStatus ? `${gitStatus.ahead} ahead / ${gitStatus.behind} behind` : "-"}
            />
            <StatRow label="Sync action" value={syncActionLabel} />
          </Group>

          <Group title="Commit history">
            {gitHistoryError ? (
              <p className="mobile-native-note">{gitHistoryError}</p>
            ) : null}
            {!gitHistoryError && gitCommitHistory.length === 0 && !gitHistoryBusy ? (
              <p className="mobile-native-note">No commits yet.</p>
            ) : null}
            {gitCommitHistory.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`mobile-native-row choice mobile-sync-history-row${selectedCommit?.id === item.id ? " active" : ""}`}
                onClick={() => setSelectedCommitId(item.id)}
              >
                <span className="mobile-native-row-main">
                  <span className="mobile-native-row-label">{formatCommitSummaryForApp(item.summary)}</span>
                  <span className="mobile-native-row-sub">
                    {item.short_id} · {formatGitCommitTime(item.authored_ms)}
                  </span>
                </span>
                <span className="mobile-native-row-value">{formatGitCommitStateLabel(item.sync_state)}</span>
              </button>
            ))}
          </Group>

          {selectedCommit ? (
            <Group title="Commit details">
              <StatRow label="Message" value={formatCommitSummaryForApp(selectedCommit.summary)} />
              <StatRow label="Commit" value={selectedCommit.short_id} />
              <StatRow label="Author" value={selectedCommit.author} />
              <StatRow label="When" value={formatGitCommitTime(selectedCommit.authored_ms)} />
              <StatRow label="State" value={formatGitCommitStateLabel(selectedCommit.sync_state)} />
              <StatRow label="Position" value={selectedCommit.is_head ? "Latest" : "History"} />
            </Group>
          ) : null}

          {gitSyncError ? (
            <section className="mobile-sync-error" role="alert">
              <strong>Sync error</strong>
              <p>{gitSyncError}</p>
              {syncHint ? <p className="hint">{syncHint}</p> : null}
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
