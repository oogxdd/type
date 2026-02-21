import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { useProfiles } from "../../contexts/ProfilesContext";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

type GitDraftSettings = {
  gitRemoteUrl: string;
  gitBranch: string;
  gitCommitMessage: string;
  gitUsername: string;
  gitPassword: string;
};

const getGitDraftFromSyncSettings = (syncSettings: {
  gitRemoteUrl: string;
  gitBranch: string;
  gitCommitMessage: string;
  gitUsername: string;
  gitPassword: string;
}): GitDraftSettings => ({
  gitRemoteUrl: syncSettings.gitRemoteUrl,
  gitBranch: syncSettings.gitBranch,
  gitCommitMessage: syncSettings.gitCommitMessage,
  gitUsername: syncSettings.gitUsername,
  gitPassword: syncSettings.gitPassword,
});

export function SettingsProfileSection() {
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
  const [notesRootInput, setNotesRootInput] = useState("");
  const [gitDraft, setGitDraft] = useState<GitDraftSettings>(() =>
    getGitDraftFromSyncSettings(syncSettings)
  );

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [activeProfileId, profiles]
  );

  useEffect(() => {
    setNotesRootInput(activeProfile?.notes_root ?? "");
  }, [activeProfile?.notes_root]);

  useEffect(() => {
    setGitDraft(getGitDraftFromSyncSettings(syncSettings));
  }, [activeProfileId]);

  const hasUnsavedGitChanges =
    gitDraft.gitRemoteUrl !== syncSettings.gitRemoteUrl ||
    gitDraft.gitBranch !== syncSettings.gitBranch ||
    gitDraft.gitCommitMessage !== syncSettings.gitCommitMessage ||
    gitDraft.gitUsername !== syncSettings.gitUsername ||
    gitDraft.gitPassword !== syncSettings.gitPassword;

  useEffect(() => {
    if (hasUnsavedGitChanges) {
      return;
    }
    setGitDraft(getGitDraftFromSyncSettings(syncSettings));
  }, [hasUnsavedGitChanges, syncSettings]);

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

  return (
    <>
      <div className="settings-detail-hero">
        <h2 className="settings-detail-title">Profile</h2>
      </div>
      <div className="settings-section-stack">
        <section className="settings-group">
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
                {profilesBusy ? "Working..." : "New"}
              </Button>
            </div>
          </label>
          {profilesError ? (
            <p className="settings-warning-text settings-inline-warning">{profilesError}</p>
          ) : null}
        </section>

        <section className="settings-group">
          <h3 className="settings-group-title">Git</h3>
          <label className="settings-control">
            <span>Remote URL</span>
            <Input
              type="text"
              value={gitDraft.gitRemoteUrl}
              onChange={(event) => setGitDraft((prev) => ({ ...prev, gitRemoteUrl: event.target.value }))}
              placeholder="https://github.com/you/notes.git"
            />
          </label>
          <label className="settings-control">
            <span>Branch</span>
            <Input
              type="text"
              value={gitDraft.gitBranch}
              onChange={(event) => setGitDraft((prev) => ({ ...prev, gitBranch: event.target.value }))}
              placeholder="main"
            />
          </label>
          <label className="settings-control">
            <span>Commit message</span>
            <Input
              type="text"
              value={gitDraft.gitCommitMessage}
              onChange={(event) =>
                setGitDraft((prev) => ({ ...prev, gitCommitMessage: event.target.value }))
              }
              placeholder="Sync notes"
            />
          </label>
          <label className="settings-control">
            <span>Username</span>
            <Input
              type="text"
              value={gitDraft.gitUsername}
              onChange={(event) => setGitDraft((prev) => ({ ...prev, gitUsername: event.target.value }))}
              placeholder="Optional"
              autoCapitalize="off"
              autoCorrect="off"
            />
          </label>
          <label className="settings-control">
            <span>Token</span>
            <Input
              type="password"
              value={gitDraft.gitPassword}
              onChange={(event) => setGitDraft((prev) => ({ ...prev, gitPassword: event.target.value }))}
              placeholder="Optional"
              autoCapitalize="off"
              autoCorrect="off"
            />
          </label>
          <div className="settings-action-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!activeProfileId || profilesBusy || !hasUnsavedGitChanges}
              onClick={() =>
                updateSyncSettings({
                  gitRemoteUrl: gitDraft.gitRemoteUrl,
                  gitBranch: gitDraft.gitBranch,
                  gitCommitMessage: gitDraft.gitCommitMessage,
                  gitUsername: gitDraft.gitUsername,
                  gitPassword: gitDraft.gitPassword,
                })
              }
            >
              Apply Git settings
            </Button>
          </div>
          <p className="settings-inline-help">
            Changes only take effect after clicking Apply Git settings.
            {hasUnsavedGitChanges ? " You have unsaved changes." : ""}
          </p>
        </section>

        <section className="settings-group">
          <h3 className="settings-group-title">Notes folder</h3>
          <div className="settings-control">
            <div className="settings-inline-row">
              <Input
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
                Browse
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
          </div>
        </section>
      </div>
    </>
  );
}
