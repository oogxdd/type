import { useEffect, useMemo, useState } from "react";
import { useProfiles } from "../../../contexts/ProfilesContext";
import { Group, ChoiceRow, InputRow } from "./SettingsHelpers";

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

export function MobileProfileSection() {
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

  return (
    <>
      <Group title="Profile">
        {profiles.length === 0 ? (
          <p className="mobile-native-note">No profiles yet.</p>
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
        <div className="mobile-native-actions single">
          <button
            type="button"
            className="mobile-secondary-btn"
            onClick={() => void createProfile()}
            disabled={profilesBusy}
          >
            {profilesBusy ? "Working..." : "New profile"}
          </button>
        </div>
        {profilesError ? <p className="mobile-native-note">{profilesError}</p> : null}
      </Group>

      <Group title="Git">
        <InputRow
          label="Remote URL"
          value={gitDraft.gitRemoteUrl}
          onChange={(value) => setGitDraft((prev) => ({ ...prev, gitRemoteUrl: value }))}
          placeholder="https://github.com/you/notes.git"
        />
        <InputRow
          label="Branch"
          value={gitDraft.gitBranch}
          onChange={(value) => setGitDraft((prev) => ({ ...prev, gitBranch: value }))}
          placeholder="main"
        />
        <InputRow
          label="Commit message"
          value={gitDraft.gitCommitMessage}
          onChange={(value) => setGitDraft((prev) => ({ ...prev, gitCommitMessage: value }))}
          placeholder="Sync notes"
        />
        <InputRow
          label="Username"
          value={gitDraft.gitUsername}
          onChange={(value) => setGitDraft((prev) => ({ ...prev, gitUsername: value }))}
          placeholder="Optional"
        />
        <InputRow
          label="Token"
          value={gitDraft.gitPassword}
          onChange={(value) => setGitDraft((prev) => ({ ...prev, gitPassword: value }))}
          placeholder="Optional"
          password
        />
        <div className="mobile-native-actions single">
          <button
            type="button"
            className="mobile-secondary-btn"
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
          </button>
        </div>
        <p className="mobile-native-note">
          Changes only take effect after tapping Apply Git settings.
          {hasUnsavedGitChanges ? " You have unsaved changes." : ""}
        </p>
      </Group>

      <Group title="Notes folder">
        <InputRow
          label="Path"
          value={notesRootInput}
          onChange={setNotesRootInput}
          placeholder={activeProfileNotesRoot || "/Users/you/Documents/type"}
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
            Apply
          </button>
        </div>
      </Group>
    </>
  );
}
