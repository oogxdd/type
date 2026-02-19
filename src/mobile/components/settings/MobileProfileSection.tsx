import { useEffect, useMemo, useState } from "react";
import { useProfiles } from "../../../contexts/ProfilesContext";
import { Group, ChoiceRow, InputRow, StatRow } from "./SettingsHelpers";

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
        <StatRow label="Current" value={activeProfile?.name ?? "No profile"} />
        <div className="mobile-native-actions single">
          <button
            type="button"
            className="mobile-primary-btn"
            onClick={() => void createProfile()}
            disabled={profilesBusy}
          >
            {profilesBusy ? "Working..." : "New profile"}
          </button>
        </div>
        {profilesError ? <p className="mobile-native-note">{profilesError}</p> : null}
      </Group>

      <Group title="Switch profile">
        {profiles.length === 0 ? (
          <p className="mobile-native-note">No profiles available.</p>
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
      </Group>

      <Group title="Notes folder">
        <StatRow label="Current path" value={activeProfileNotesRoot || "-"} />
        <InputRow
          label="New path"
          value={notesRootInput}
          onChange={setNotesRootInput}
          placeholder="/Users/you/Documents/type"
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
            Apply path
          </button>
        </div>
      </Group>

      <Group title="Git setup">
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
