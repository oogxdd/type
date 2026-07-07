import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { getErrorMessage } from "@/shared/lib/errors";

export type GitDraftSettings = {
  gitRemoteUrl: string;
  gitBranch: string;
  gitCommitMessage: string;
  gitUsername: string;
  gitPassword: string;
};

// Pick just the git fields out of the (larger) profile sync settings.
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
  onApply: (next: GitDraftSettings) => Promise<void>;
};

const cardClass = "space-y-3 rounded-lg border border-border/70 bg-card/30 p-4";
const controlClass = "grid gap-2 text-sm";
const labelClass = "text-sm font-medium text-foreground";
const hintClass = "text-xs text-muted-foreground";

/**
 * Git sync settings form. Edits are buffered in a local draft and only pushed
 * to the profile (via onApply) when the user clicks "Apply Git settings". The
 * draft resets on profile switch and stays synced to external changes while it
 * has no unsaved edits.
 */
export function GitSettingsCard({ gitSettings, activeProfileId, busy, onApply }: GitSettingsCardProps) {
  const [gitDraft, setGitDraft] = useState<GitDraftSettings>(() => getGitDraft(gitSettings));

  // Reset the draft when the active profile changes.
  useEffect(() => {
    setGitDraft(getGitDraft(gitSettings));
  }, [activeProfileId]);

  const hasUnsavedGitChanges =
    gitDraft.gitRemoteUrl !== gitSettings.gitRemoteUrl ||
    gitDraft.gitBranch !== gitSettings.gitBranch ||
    gitDraft.gitCommitMessage !== gitSettings.gitCommitMessage ||
    gitDraft.gitUsername !== gitSettings.gitUsername ||
    gitDraft.gitPassword !== gitSettings.gitPassword;

  // Absorb external setting changes while the draft has no unsaved edits.
  useEffect(() => {
    if (hasUnsavedGitChanges) {
      return;
    }
    setGitDraft(getGitDraft(gitSettings));
  }, [hasUnsavedGitChanges, gitSettings]);

  return (
    <section className={cardClass}>
      <h3 className="text-sm font-semibold text-foreground">Git</h3>
      <label className={controlClass}>
        <span className={labelClass}>Remote URL</span>
        <Input
          type="text"
          value={gitDraft.gitRemoteUrl}
          onChange={(event) => setGitDraft((prev) => ({ ...prev, gitRemoteUrl: event.target.value }))}
          placeholder="git://192.168.1.15/notes.git"
        />
      </label>
      <label className={controlClass}>
        <span className={labelClass}>Branch</span>
        <Input
          type="text"
          value={gitDraft.gitBranch}
          onChange={(event) => setGitDraft((prev) => ({ ...prev, gitBranch: event.target.value }))}
          placeholder="main"
        />
      </label>
      <label className={controlClass}>
        <span className={labelClass}>Commit message</span>
        <Input
          type="text"
          value={gitDraft.gitCommitMessage}
          onChange={(event) =>
            setGitDraft((prev) => ({ ...prev, gitCommitMessage: event.target.value }))
          }
          placeholder="Sync notes"
        />
      </label>
      <label className={controlClass}>
        <span className={labelClass}>Username</span>
        <Input
          type="text"
          value={gitDraft.gitUsername}
          onChange={(event) => setGitDraft((prev) => ({ ...prev, gitUsername: event.target.value }))}
          placeholder="Optional"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </label>
      <label className={controlClass}>
        <span className={labelClass}>Password / Token</span>
        <Input
          type="password"
          value={gitDraft.gitPassword}
          onChange={(event) => setGitDraft((prev) => ({ ...prev, gitPassword: event.target.value }))}
          placeholder="Optional"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!activeProfileId || busy || !hasUnsavedGitChanges}
          onClick={async () => {
            try {
              await onApply(gitDraft);
              toast.success("Git settings saved");
            } catch (error) {
              toast.error("Failed to save", { description: getErrorMessage(error) });
            }
          }}
        >
          {busy ? "Saving…" : "Apply Git settings"}
        </Button>
      </div>
      <p className={hintClass}>
        Changes only take effect after clicking Apply Git settings.
        {hasUnsavedGitChanges ? " You have unsaved changes." : ""}
      </p>
      <p className={hintClass}>
        Supported remote schemes: <code>git://</code>, <code>ssh://</code>, and <code>https://</code>.
      </p>
    </section>
  );
}
