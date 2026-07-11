import { useEffect, useMemo } from "react";
import { refreshTree } from "@/state/notes-store";
import {
  connectGitRepo,
  gitPull,
  gitPush,
  refreshGitHistory,
  refreshGitStatus,
  selectGitSyncBusy,
  syncNow,
  useGitSyncStore,
} from "@/state/git-sync-store";
import {
  selectSyncSettings,
  useProfilesStore,
} from "@/state/profiles-store";
import { useSettingsData } from "@/hooks/use-settings-data";
import {
  formatCommitSummaryForApp,
  formatGitCommitStateLabel,
  formatGitCommitTime,
  getSyncHint,
} from "@typenotes/shared/format";
import { Button } from "@/components/ui/button";
import { LocalSyncServerCard } from "@/components/sync/local-sync-server-card";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsErrorText,
  SettingsHelpText,
  SettingsInfoGrid,
  SettingsInfoRow,
  SettingsSection,
} from "./settings-ui";

export function SettingsSyncSection() {
  const syncSettings = useProfilesStore(selectSyncSettings);
  const gitStatus = useGitSyncStore((state) => state.status);
  const gitSyncAction = useGitSyncStore((state) => state.action);
  const gitSyncError = useGitSyncStore((state) => state.error);
  const gitSyncBusy = useGitSyncStore(selectGitSyncBusy);
  const gitCommitHistory = useGitSyncStore((state) => state.history);
  const gitHistoryBusy = useGitSyncStore((state) => state.historyBusy);
  const gitHistoryError = useGitSyncStore((state) => state.historyError);
  const { canPull, canPush, canConnect, canSync } = useSettingsData();

  useEffect(() => {
    void refreshGitStatus();
    void refreshGitHistory();
  }, []);

  const syncHint = useMemo(() => getSyncHint(gitSyncError), [gitSyncError]);
  const lastSuccessfulSyncAt = syncSettings.lastSuccessfulSyncAt
    ? new Date(syncSettings.lastSuccessfulSyncAt).toLocaleString()
    : null;
  const visibleCommits = gitCommitHistory.slice(0, 8);

  return (
    <SettingsSection title="Sync">
      <SettingsCard>
        <SettingsInfoGrid>
          <SettingsInfoRow label="Status">
            <code className="text-xs">
              {gitStatus?.repo_initialized ? "Connected" : "Not connected"}
            </code>
          </SettingsInfoRow>
          <SettingsInfoRow label="Branch">
            <code className="text-xs">
              {gitStatus?.current_branch || syncSettings.gitBranch || "-"}
            </code>
          </SettingsInfoRow>
          {gitStatus && (gitStatus.ahead > 0 || gitStatus.behind > 0) ? (
            <SettingsInfoRow label="Ahead / behind">
              <code className="text-xs">{gitStatus.ahead} / {gitStatus.behind}</code>
            </SettingsInfoRow>
          ) : null}
          <SettingsInfoRow label="Last sync">
            <code className="text-xs">{lastSuccessfulSyncAt ?? "Never"}</code>
          </SettingsInfoRow>
        </SettingsInfoGrid>

        {gitSyncError ? (
          <SettingsErrorText>{gitSyncError}</SettingsErrorText>
        ) : null}
        {syncHint ? <SettingsHelpText>{syncHint}</SettingsHelpText> : null}

        <SettingsActionRow>
          <Button
            size="sm"
            type="button"
            onClick={() => void syncNow({ onAfterPull: () => refreshTree() })}
            disabled={!canSync}
          >
            {gitSyncAction === "sync" ? "Syncing..." : "Sync now"}
          </Button>
          {!gitStatus?.repo_initialized ? (
            <Button
              variant="outline"
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
        </SettingsActionRow>
      </SettingsCard>

      <LocalSyncServerCard />

      {visibleCommits.length > 0 || gitHistoryBusy ? (
        <SettingsCard title="Recent commits">
          {gitHistoryError ? (
            <SettingsErrorText>{gitHistoryError}</SettingsErrorText>
          ) : null}
          <SettingsInfoGrid>
            {visibleCommits.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>
            ) : (
              visibleCommits.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2.5 last:border-b-0"
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
          </SettingsInfoGrid>
        </SettingsCard>
      ) : null}
    </SettingsSection>
  );
}
