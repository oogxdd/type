import { useEffect, useMemo, useState } from "react";
import { formatHistoryTime, getSyncHint } from "../../../utils/format";
import { useSettingsData } from "../../../hooks/useSettingsData";
import { useSessions } from "../../../contexts/SessionsContext";
import { useGitSync } from "../../../contexts/GitSyncContext";
import { useNotesTree } from "../../../contexts/NotesTreeContext";
import { Group, InputRow, StatRow } from "./SettingsHelpers";

export function MobileSyncSection() {
  const { syncSettings, updateSyncSettings } = useSessions();
  const {
    gitStatus,
    gitSyncAction,
    gitSyncError,
    gitSyncBusy,
    gitSyncHistory,
    refreshGitStatus,
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
  const [syncView, setSyncView] = useState<"credentials" | "actions">("actions");
  const [selectedSyncHistoryId, setSelectedSyncHistoryId] = useState<string | null>(null);

  const visibleSyncHistory = useMemo(
    () =>
      gitSyncHistory
        .filter((item) => item.action === "pull" || item.action === "push")
        .slice(0, 12),
    [gitSyncHistory]
  );
  const selectedSyncHistory = useMemo(() => {
    if (visibleSyncHistory.length === 0) {
      return null;
    }
    if (!selectedSyncHistoryId) {
      return visibleSyncHistory[0];
    }
    return visibleSyncHistory.find((item) => item.id === selectedSyncHistoryId) ?? visibleSyncHistory[0];
  }, [selectedSyncHistoryId, visibleSyncHistory]);

  useEffect(() => {
    if (visibleSyncHistory.length === 0) {
      if (selectedSyncHistoryId) {
        setSelectedSyncHistoryId(null);
      }
      return;
    }
    if (!selectedSyncHistoryId || !visibleSyncHistory.some((item) => item.id === selectedSyncHistoryId)) {
      setSelectedSyncHistoryId(visibleSyncHistory[0].id);
    }
  }, [selectedSyncHistoryId, visibleSyncHistory]);

  return (
    <>
      <Group title="Sync views">
        <div className="mobile-segment">
          <button
            type="button"
            className={`mobile-segment-btn${syncView === "credentials" ? " active" : ""}`}
            onClick={() => setSyncView("credentials")}
          >
            Credentials
          </button>
          <button
            type="button"
            className={`mobile-segment-btn${syncView === "actions" ? " active" : ""}`}
            onClick={() => setSyncView("actions")}
          >
            Actions
          </button>
        </div>
      </Group>

      {syncView === "credentials" ? (
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
                onClick={() => void refreshGitStatus()}
                disabled={gitSyncBusy}
              >
                {gitSyncAction === "refresh" ? "Refreshing..." : "Refresh status"}
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

          <Group title="Recent pull/push">
            {visibleSyncHistory.length === 0 ? (
              <p className="mobile-native-note">No pull/push history yet.</p>
            ) : (
              visibleSyncHistory.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`mobile-native-row choice mobile-sync-history-row${selectedSyncHistory?.id === item.id ? " active" : ""}`}
                  onClick={() => setSelectedSyncHistoryId(item.id)}
                >
                  <span className="mobile-native-row-main">
                    <span className="mobile-native-row-label">
                      {item.action === "pull"
                        ? "Pull"
                        : item.action === "push"
                          ? "Push"
                          : "Connect repo"}
                    </span>
                    <span className="mobile-native-row-sub">
                      {formatHistoryTime(item.finished_at)} · {item.branch || "-"}
                    </span>
                  </span>
                  <span className="mobile-native-row-value">
                    {item.status === "success" ? "Success" : "Failed"}
                  </span>
                </button>
              ))
            )}
          </Group>

          {selectedSyncHistory ? (
            <Group title="Action details">
              <StatRow
                label="Action"
                value={
                  selectedSyncHistory.action === "pull"
                    ? "Pull"
                    : selectedSyncHistory.action === "push"
                      ? "Push"
                      : "Connect repo"
                }
              />
              <StatRow
                label="Result"
                value={selectedSyncHistory.status === "success" ? "Success" : "Failed"}
              />
              <StatRow
                label="When"
                value={`${formatHistoryTime(selectedSyncHistory.started_at)} → ${formatHistoryTime(selectedSyncHistory.finished_at)}`}
              />
              <StatRow label="Branch" value={selectedSyncHistory.branch || "-"} />
              <StatRow label="Remote URL" value={selectedSyncHistory.remote_url || "-"} />
              <StatRow
                label="Ahead / behind (before)"
                value={
                  selectedSyncHistory.before
                    ? `${selectedSyncHistory.before.ahead} ahead / ${selectedSyncHistory.before.behind} behind`
                    : "-"
                }
              />
              <StatRow
                label="Ahead / behind (after)"
                value={
                  selectedSyncHistory.after
                    ? `${selectedSyncHistory.after.ahead} ahead / ${selectedSyncHistory.after.behind} behind`
                    : "-"
                }
              />
              {selectedSyncHistory.commit_message ? (
                <StatRow label="Commit message" value={selectedSyncHistory.commit_message} />
              ) : null}
              {selectedSyncHistory.error_message ? (
                <p className="mobile-native-note">{selectedSyncHistory.error_message}</p>
              ) : null}
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
