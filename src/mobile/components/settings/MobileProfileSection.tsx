import { useEffect, useMemo, useState } from "react";
import { useProfiles } from "../../../contexts/ProfilesContext";
import { Group, ChoiceRow, InputRow } from "./SettingsHelpers";

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

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [activeProfileId, profiles]
  );

  useEffect(() => {
    setNotesRootInput(activeProfile?.notes_root ?? "");
  }, [activeProfile?.notes_root]);

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

      <Group title="Git">
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
          placeholder="Optional"
        />
        <InputRow
          label="Token"
          value={syncSettings.gitPassword}
          onChange={(value) => updateSyncSettings({ gitPassword: value })}
          placeholder="Optional"
          password
        />
      </Group>
    </>
  );
}
