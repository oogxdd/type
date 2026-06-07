import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { useSshKey } from "@/features/sync/hooks/use-ssh-key";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { GitSettingsCard } from "./git-settings-card";
import { ProfileManagerDialog } from "./profile-manager-dialog";

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

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [activeProfileId, profiles]
  );

  useEffect(() => {
    setNotesRootInput(activeProfile?.notes_root ?? "");
  }, [activeProfile?.notes_root]);

  const { sshPublicKey, sshBusy, sshError, generateSshKey, deleteSshKey } =
    useSshKey();

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

  const cardClass = "space-y-3 rounded-lg border border-border/70 bg-card/30 p-4";
  const controlClass = "grid gap-2 text-sm";
  const labelClass = "text-sm font-medium text-foreground";
  const hintClass = "text-xs text-muted-foreground";
  const warningClass = "text-xs text-destructive";
  const actionRowClass = "flex flex-wrap gap-2";

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Profile</h2>
      </div>
      <div className="space-y-4">
        <section className={cardClass}>
          <label className={controlClass}>
            <span className={labelClass}>Active profile</span>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-9 min-w-[220px] flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring/60"
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
            <p className={hintClass}>{activeProfile.description}</p>
          ) : null}
          {profilesError ? <p className={warningClass}>{profilesError}</p> : null}
        </section>

        <GitSettingsCard
          gitSettings={syncSettings}
          activeProfileId={activeProfileId}
          busy={profilesBusy}
          onApply={(next) => updateSyncSettings(next)}
        />

        <section className={cardClass}>
          <h3 className="text-sm font-semibold text-foreground">SSH key</h3>
          {sshPublicKey ? (
            <>
              <div className={controlClass}>
                <span className={labelClass}>Public key</span>
                <code
                  className="block break-all rounded bg-muted/50 p-2 text-xs text-foreground select-all"
                >
                  {sshPublicKey}
                </code>
              </div>
              <p className={hintClass}>
                Add this key to <code>~/.ssh/authorized_keys</code> on your server.
              </p>
              <div className={actionRowClass}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void navigator.clipboard.writeText(sshPublicKey)}
                >
                  Copy
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={sshBusy}
                  onClick={() => void deleteSshKey()}
                >
                  Delete key
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className={hintClass}>
                Generate an Ed25519 keypair for SSH-based git sync.
              </p>
              <div className={actionRowClass}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={sshBusy}
                  onClick={() => void generateSshKey()}
                >
                  {sshBusy ? "Generating..." : "Generate SSH key"}
                </Button>
              </div>
            </>
          )}
          {sshError ? <p className={warningClass}>{sshError}</p> : null}
        </section>

        <section className={cardClass}>
          <h3 className="text-sm font-semibold text-foreground">Notes folder</h3>
          <div className={controlClass}>
            <div className="flex flex-wrap items-center gap-2">
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

      <ProfileManagerDialog
        open={profileManagerOpen}
        onOpenChange={setProfileManagerOpen}
        profiles={profiles}
        activeProfileId={activeProfileId}
        profilesBusy={profilesBusy}
        switchProfile={switchProfile}
        createProfile={createProfile}
        updateProfile={updateProfile}
        deleteProfile={deleteProfile}
      />
    </div>
  );
}
