import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { useProfiles } from "../../contexts/ProfilesContext";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
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
    updateProfile,
    deleteProfile,
    setProfileNotesRoot,
    syncSettings,
    updateSyncSettings,
  } = useProfiles();
  const [notesRootInput, setNotesRootInput] = useState("");
  const [profileManagerOpen, setProfileManagerOpen] = useState(false);
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

  const createProfileDisabled = profilesBusy || !newProfileName.trim();

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
                onClick={() => setProfileManagerOpen(true)}
                disabled={profilesBusy}
              >
                Manage profiles
              </Button>
            </div>
          </label>
          {activeProfile?.description ? (
            <p className="settings-inline-help">{activeProfile.description}</p>
          ) : null}
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

      <Dialog open={profileManagerOpen} onOpenChange={setProfileManagerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage profiles</DialogTitle>
            <DialogDescription>
              Create, rename, and remove profiles. Deleting a profile keeps its notes folder on disk.
            </DialogDescription>
          </DialogHeader>
          <div className="settings-section-stack">
            <section className="settings-group">
              <h3 className="settings-group-title">Create profile</h3>
              <label className="settings-control">
                <span>Name</span>
                <Input
                  type="text"
                  value={newProfileName}
                  onChange={(event) => setNewProfileName(event.target.value)}
                  placeholder="Work"
                />
              </label>
              <label className="settings-control">
                <span>Description</span>
                <Input
                  type="text"
                  value={newProfileDescription}
                  onChange={(event) => setNewProfileDescription(event.target.value)}
                  placeholder="Short label for this profile"
                />
              </label>
              <div className="settings-action-row">
                <Button
                  type="button"
                  size="sm"
                  disabled={createProfileDisabled}
                  onClick={() => {
                    void createProfile({
                      name: newProfileName.trim(),
                      description: newProfileDescription.trim(),
                    });
                    setNewProfileName("");
                    setNewProfileDescription("");
                  }}
                >
                  {profilesBusy ? "Working..." : "Create profile"}
                </Button>
              </div>
            </section>

            <section className="settings-group">
              <h3 className="settings-group-title">Existing profiles</h3>
              {profiles.map((profile) => {
                const draft = profileDrafts[profile.id] ?? {
                  name: profile.name,
                  description: profile.description ?? "",
                };
                const hasDraftChanges =
                  draft.name !== profile.name ||
                  draft.description !== (profile.description ?? "");
                return (
                  <div key={profile.id} className="settings-control">
                    <div className="settings-inline-row">
                      <Button
                        type="button"
                        variant={activeProfileId === profile.id ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => void switchProfile(profile.id)}
                        disabled={profilesBusy}
                      >
                        {activeProfileId === profile.id ? "Active" : "Switch"}
                      </Button>
                    </div>
                    <label className="settings-control">
                      <span>Name</span>
                      <Input
                        type="text"
                        value={draft.name}
                        onChange={(event) =>
                          setProfileDrafts((prev) => ({
                            ...prev,
                            [profile.id]: {
                              name: event.target.value,
                              description: draft.description,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="settings-control">
                      <span>Description</span>
                      <Input
                        type="text"
                        value={draft.description}
                        onChange={(event) =>
                          setProfileDrafts((prev) => ({
                            ...prev,
                            [profile.id]: {
                              name: draft.name,
                              description: event.target.value,
                            },
                          }))
                        }
                        placeholder="Short label for this profile"
                      />
                    </label>
                    <div className="settings-action-row">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={profilesBusy || !hasDraftChanges}
                        onClick={() =>
                          void updateProfile(profile.id, {
                            name: draft.name,
                            description: draft.description,
                          })
                        }
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={profilesBusy || profiles.length <= 1}
                        onClick={() => {
                          if (!window.confirm(`Delete profile "${profile.name}"?`)) {
                            return;
                          }
                          void deleteProfile(profile.id);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </section>
          </div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </>
  );
}
