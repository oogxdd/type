import { useEffect, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsField,
  SettingsHelpText,
} from "../settings-ui";

export type GitDraftSettings = {
  gitRemoteUrl: string;
  gitBranch: string;
  gitCommitMessage: string;
  gitUsername: string;
  gitPassword: string;
};

const getGitDraft = (settings: GitDraftSettings): GitDraftSettings => ({
  gitRemoteUrl: settings.gitRemoteUrl,
  gitBranch: settings.gitBranch,
  gitCommitMessage: settings.gitCommitMessage,
  gitUsername: settings.gitUsername,
  gitPassword: settings.gitPassword,
});

type GitSettingsCardProps = {
  gitSettings: GitDraftSettings;
  activeProfileId: string | null;
  busy: boolean;
  onApply: (next: GitDraftSettings) => void;
};

export function GitSettingsCard({ gitSettings, activeProfileId, busy, onApply }: GitSettingsCardProps) {
  const [gitDraft, setGitDraft] = useState<GitDraftSettings>(() => getGitDraft(gitSettings));

  useEffect(() => {
    setGitDraft(getGitDraft(gitSettings));
  }, [activeProfileId]);

  const hasUnsavedGitChanges =
    gitDraft.gitRemoteUrl !== gitSettings.gitRemoteUrl ||
    gitDraft.gitBranch !== gitSettings.gitBranch ||
    gitDraft.gitCommitMessage !== gitSettings.gitCommitMessage ||
    gitDraft.gitUsername !== gitSettings.gitUsername ||
    gitDraft.gitPassword !== gitSettings.gitPassword;

  useEffect(() => {
    if (hasUnsavedGitChanges) {
      return;
    }
    setGitDraft(getGitDraft(gitSettings));
  }, [hasUnsavedGitChanges, gitSettings]);

  return (
    <SettingsCard title="Git">
      <SettingsField label="Remote URL">
        <Input
          type="text"
          value={gitDraft.gitRemoteUrl}
          onChange={(event) => setGitDraft((prev) => ({ ...prev, gitRemoteUrl: event.target.value }))}
          placeholder="git://192.168.1.15/notes.git"
        />
      </SettingsField>
      <SettingsField label="Branch">
        <Input
          type="text"
          value={gitDraft.gitBranch}
          onChange={(event) => setGitDraft((prev) => ({ ...prev, gitBranch: event.target.value }))}
          placeholder="main"
        />
      </SettingsField>
      <SettingsField label="Commit message">
        <Input
          type="text"
          value={gitDraft.gitCommitMessage}
          onChange={(event) =>
            setGitDraft((prev) => ({ ...prev, gitCommitMessage: event.target.value }))
          }
          placeholder="Sync notes"
        />
      </SettingsField>
      <SettingsField label="Username">
        <Input
          type="text"
          value={gitDraft.gitUsername}
          onChange={(event) => setGitDraft((prev) => ({ ...prev, gitUsername: event.target.value }))}
          placeholder="Optional"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </SettingsField>
      <SettingsField label="Password / Token">
        <Input
          type="password"
          value={gitDraft.gitPassword}
          onChange={(event) => setGitDraft((prev) => ({ ...prev, gitPassword: event.target.value }))}
          placeholder="Optional"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </SettingsField>
      <SettingsActionRow>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!activeProfileId || busy || !hasUnsavedGitChanges}
          onClick={() => onApply(gitDraft)}
        >
          Apply Git settings
        </Button>
      </SettingsActionRow>
      <SettingsHelpText>
        Changes only take effect after clicking Apply Git settings.
        {hasUnsavedGitChanges ? " You have unsaved changes." : ""}
      </SettingsHelpText>
      <SettingsHelpText>
        Supported remote schemes: <code>git://</code>, <code>ssh://</code>, and <code>https://</code>.
      </SettingsHelpText>
    </SettingsCard>
  );
}
