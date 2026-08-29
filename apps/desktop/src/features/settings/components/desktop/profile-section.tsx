import { homeDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { APP_EXTENSIONS } from "@/features/extensions/registry";
import { CLOUD_SYNC_PROVIDERS } from "@/features/profiles/lib/cloud-sync-providers";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { useSshKey } from "@/features/sync/hooks/use-ssh-key";
import { emitTreeInvalidated } from "@/shared/lib/notes";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { GitSettingsCard } from "./git-settings-card";
import { ProfileManagerDialog } from "./profile-manager-dialog";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsErrorText,
  SettingsField,
  SettingsHelpText,
  SettingsSection,
  SettingsSelect,
} from "../settings-ui";

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

  const chooseWorkingDirectory = async (defaultPath?: string) => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: defaultPath || notesRootInput || activeProfileNotesRoot || undefined,
        title: "Select profile notes folder",
      });
      if (typeof selected === "string" && selected.trim()) {
        setNotesRootInput(selected);
      }
    } catch (error) {
      console.error("Failed to pick working directory", error);
    }
  };

  const chooseCloudSyncFolder = async (providerId: string) => {
    const provider = CLOUD_SYNC_PROVIDERS.find((entry) => entry.id === providerId);
    if (!provider) {
      return;
    }
    try {
      const home = await homeDir();
      await chooseWorkingDirectory(provider.defaultPath(home));
    } catch (error) {
      console.error("Failed to resolve home directory", error);
      await chooseWorkingDirectory();
    }
  };

  return (
    <SettingsSection title="Profile">
      <SettingsCard>
        <SettingsField label="Active profile">
          <div className="flex flex-wrap items-center gap-2">
            <SettingsSelect
              className="min-w-[220px] flex-1"
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
            </SettingsSelect>
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
        </SettingsField>
        {activeProfile?.description ? (
          <SettingsHelpText>{activeProfile.description}</SettingsHelpText>
        ) : null}
        {profilesError ? <SettingsErrorText>{profilesError}</SettingsErrorText> : null}
      </SettingsCard>

      {APP_EXTENSIONS.sync ? (
        <>
          <GitSettingsCard
            gitSettings={syncSettings}
            activeProfileId={activeProfileId}
            busy={profilesBusy}
            onApply={(next) => updateSyncSettings(next)}
          />

          <SettingsCard title="SSH key">
            {sshPublicKey ? (
              <>
                <SettingsField label="Public key">
                  <code className="block break-all rounded bg-muted/50 p-2 text-xs text-foreground select-all">
                    {sshPublicKey}
                  </code>
                </SettingsField>
                <SettingsHelpText>
                  Add this key to <code>~/.ssh/authorized_keys</code> on your server.
                </SettingsHelpText>
                <SettingsActionRow>
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
                </SettingsActionRow>
              </>
            ) : (
              <>
                <SettingsHelpText>
                  Generate an Ed25519 keypair for SSH-based git sync.
                </SettingsHelpText>
                <SettingsActionRow>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={sshBusy}
                    onClick={() => void generateSshKey()}
                  >
                    {sshBusy ? "Generating..." : "Generate SSH key"}
                  </Button>
                </SettingsActionRow>
              </>
            )}
            {sshError ? <SettingsErrorText>{sshError}</SettingsErrorText> : null}
          </SettingsCard>
        </>
      ) : null}

      <SettingsCard title="Notes folder">
        <SettingsField label="Working directory">
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => emitTreeInvalidated()}
              title="Reload the notes folder, e.g. after a cloud sync finishes in the background"
            >
              Refresh
            </Button>
          </div>
        </SettingsField>
        <SettingsField label="Sync via a cloud drive">
          <div className="flex flex-wrap items-center gap-2">
            {CLOUD_SYNC_PROVIDERS.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                variant="secondary"
                size="sm"
                disabled={!activeProfileId || profilesBusy}
                onClick={() => void chooseCloudSyncFolder(provider.id)}
              >
                Use {provider.label}
              </Button>
            ))}
          </div>
          <SettingsHelpText>
            Pick a folder inside {CLOUD_SYNC_PROVIDERS.map((p) => p.label).join(" / ")} and it
            syncs automatically in the background. There is no conflict resolution — editing the
            same note on two devices at the same time can lose one edit.
          </SettingsHelpText>
        </SettingsField>
      </SettingsCard>

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
    </SettingsSection>
  );
}
