import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { useProfiles } from "../../contexts/ProfilesContext";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

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

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [activeProfileId, profiles]
  );

  useEffect(() => {
    setNotesRootInput(activeProfile?.notes_root ?? "");
  }, [activeProfile?.notes_root]);

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
          <h3 className="settings-group-title">Profile</h3>
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
                {profilesBusy ? "Working..." : "New profile"}
              </Button>
            </div>
          </label>
          {profilesError ? (
            <p className="settings-warning-text settings-inline-warning">{profilesError}</p>
          ) : null}
          <div className="settings-info-grid">
            <div className="settings-info-row">
              <span>Current</span>
              <code>{activeProfile?.name ?? "-"}</code>
            </div>
          </div>
        </section>

        <section className="settings-group">
          <h3 className="settings-group-title">Notes folder</h3>
          <div className="settings-control">
            <Label htmlFor="profile-working-directory">Folder path</Label>
            <div className="settings-inline-row">
              <Input
                id="profile-working-directory"
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
                Choose folder
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
            <span className="settings-inline-help">Absolute path only.</span>
            {activeProfileNotesRoot ? <code>{activeProfileNotesRoot}</code> : null}
          </div>
        </section>

        <section className="settings-group">
          <h3 className="settings-group-title">Git setup</h3>
          <label className="settings-control">
            <span>Remote URL</span>
            <Input
              type="text"
              value={syncSettings.gitRemoteUrl}
              onChange={(event) => updateSyncSettings({ gitRemoteUrl: event.target.value })}
              placeholder="https://github.com/you/notes.git"
            />
          </label>
          <label className="settings-control">
            <span>Branch</span>
            <Input
              type="text"
              value={syncSettings.gitBranch}
              onChange={(event) => updateSyncSettings({ gitBranch: event.target.value })}
              placeholder="main"
            />
          </label>
          <label className="settings-control">
            <span>Commit message</span>
            <Input
              type="text"
              value={syncSettings.gitCommitMessage}
              onChange={(event) => updateSyncSettings({ gitCommitMessage: event.target.value })}
              placeholder="Sync notes"
            />
          </label>
          <label className="settings-control">
            <span>Username (optional)</span>
            <Input
              type="text"
              value={syncSettings.gitUsername}
              onChange={(event) => updateSyncSettings({ gitUsername: event.target.value })}
              placeholder="Git username"
              autoCapitalize="off"
              autoCorrect="off"
            />
          </label>
          <label className="settings-control">
            <span>Token / password (optional)</span>
            <Input
              type="password"
              value={syncSettings.gitPassword}
              onChange={(event) => updateSyncSettings({ gitPassword: event.target.value })}
              placeholder="Personal access token"
              autoCapitalize="off"
              autoCorrect="off"
            />
          </label>
        </section>
      </div>
    </>
  );
}
