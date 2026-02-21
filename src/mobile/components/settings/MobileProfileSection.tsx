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
    updateProfile,
    deleteProfile,
    setProfileNotesRoot,
    syncSettings,
    updateSyncSettings,
  } = useProfiles();
  const [notesRootInput, setNotesRootInput] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDescription, setNewProfileDescription] = useState("");
  const [profileDrafts, setProfileDrafts] = useState<
    Record<string, { name: string; description: string }>
  >({});
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
    setProfileDrafts((prev) => {
      const next: Record<string, { name: string; description: string }> = {};
      profiles.forEach((profile) => {
        next[profile.id] = prev[profile.id] ?? {
          name: profile.name,
          description: profile.description ?? "",
        };
      });
      return next;
    });
  }, [profiles]);

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
            <div key={profile.id}>
              <ChoiceRow
                label={profile.name}
                subtitle={profile.description || undefined}
                selected={activeProfileId === profile.id}
                onClick={() => void switchProfile(profile.id)}
              />
              <InputRow
                label="Name"
                value={profileDrafts[profile.id]?.name ?? profile.name}
                onChange={(value) =>
                  setProfileDrafts((prev) => ({
                    ...prev,
                    [profile.id]: {
                      name: value,
                      description: prev[profile.id]?.description ?? profile.description ?? "",
                    },
                  }))
                }
              />
              <InputRow
                label="Description"
                value={profileDrafts[profile.id]?.description ?? profile.description ?? ""}
                onChange={(value) =>
                  setProfileDrafts((prev) => ({
                    ...prev,
                    [profile.id]: {
                      name: prev[profile.id]?.name ?? profile.name,
                      description: value,
                    },
                  }))
                }
                placeholder="Short label for this profile"
              />
              <div className="mobile-native-actions single">
                <button
                  type="button"
                  className="mobile-secondary-btn"
                  disabled={
                    profilesBusy ||
                    ((profileDrafts[profile.id]?.name ?? profile.name) === profile.name &&
                      (profileDrafts[profile.id]?.description ?? profile.description ?? "") ===
                        (profile.description ?? ""))
                  }
                  onClick={() =>
                    void updateProfile(profile.id, {
                      name: profileDrafts[profile.id]?.name ?? profile.name,
                      description:
                        profileDrafts[profile.id]?.description ?? profile.description ?? "",
                    })
                  }
                >
                  Save
                </button>
                <button
                  type="button"
                  className="mobile-secondary-btn"
                  disabled={profilesBusy || profiles.length <= 1}
                  onClick={() => {
                    if (!window.confirm(`Delete profile "${profile.name}"?`)) {
                      return;
                    }
                    void deleteProfile(profile.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
        <InputRow
          label="New profile name"
          value={newProfileName}
          onChange={setNewProfileName}
          placeholder="Work"
          disabled={profilesBusy}
        />
        <InputRow
          label="Description"
          value={newProfileDescription}
          onChange={setNewProfileDescription}
          placeholder="Short label for this profile"
          disabled={profilesBusy}
        />
        <div className="mobile-native-actions single">
          <button
            type="button"
            className="mobile-secondary-btn"
            onClick={() => {
              void createProfile({
                name: newProfileName.trim(),
                description: newProfileDescription.trim(),
              });
              setNewProfileName("");
              setNewProfileDescription("");
            }}
            disabled={profilesBusy || !newProfileName.trim()}
          >
            {profilesBusy ? "Working..." : "Create profile"}
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
