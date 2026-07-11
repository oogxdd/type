import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, FolderPlus, X } from "lucide-react";
import {
  addWorkingFolder,
  deleteProfile,
  folderDisplayName,
  selectActiveProfileId,
  selectActiveProfileNotesRoot,
  selectProfiles,
  selectSyncSettings,
  setProfileNotesRoot,
  switchProfile,
  updateSyncSettings,
  useProfilesStore,
} from "@/state/profiles-store";
import { useSshKey } from "@/hooks/use-ssh-key";
import { confirmAction } from "@/lib/dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GitSettingsCard } from "./git-settings-card";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsErrorText,
  SettingsField,
  SettingsHelpText,
  SettingsSection,
} from "./settings-ui";

const pickDirectory = async (title: string, defaultPath?: string | null) => {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: defaultPath || undefined,
      title,
    });
    return typeof selected === "string" && selected.trim() ? selected : null;
  } catch (error) {
    console.error("Failed to pick working directory", error);
    return null;
  }
};

export function SettingsProfileSection() {
  const profiles = useProfilesStore(selectProfiles);
  const activeProfileId = useProfilesStore(selectActiveProfileId);
  const activeNotesRoot = useProfilesStore(selectActiveProfileNotesRoot);
  const profilesBusy = useProfilesStore((state) => state.busy);
  const profilesError = useProfilesStore((state) => state.error);
  const syncSettings = useProfilesStore(selectSyncSettings);

  const { sshPublicKey, sshBusy, sshError, generateSshKey, deleteSshKey } =
    useSshKey();

  const onAddFolder = async () => {
    const directory = await pickDirectory("Add working folder");
    if (directory) {
      await addWorkingFolder(directory);
    }
  };

  const onMoveActiveFolder = async () => {
    if (!activeProfileId) return;
    const directory = await pickDirectory("Move working folder", activeNotesRoot);
    if (!directory || directory === activeNotesRoot) return;
    const confirmed = await confirmAction(
      `Move all notes from "${activeNotesRoot}" to "${directory}"?`
    );
    if (confirmed) {
      await setProfileNotesRoot(activeProfileId, directory);
    }
  };

  const onRemoveFolder = async (profileId: string, notesRoot: string) => {
    const confirmed = await confirmAction(
      `Remove "${notesRoot}" from the list? The folder and its notes stay on disk.`
    );
    if (confirmed) {
      await deleteProfile(profileId);
    }
  };

  return (
    <SettingsSection title="Working folders">
      <SettingsCard>
        <div className="flex flex-col gap-1">
          {profiles.map((profile) => {
            const isActive = profile.id === activeProfileId;
            return (
              <div
                key={profile.id}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2",
                  isActive ? "border-primary/40 bg-muted/40" : "border-transparent"
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col items-start text-left disabled:opacity-60"
                  disabled={profilesBusy || isActive}
                  onClick={() => void switchProfile(profile.id)}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />
                    {folderDisplayName(profile.notes_root)}
                    {isActive ? (
                      <span className="text-xs font-normal text-muted-foreground">
                        — current
                      </span>
                    ) : null}
                  </span>
                  <span className="max-w-full truncate text-xs text-muted-foreground">
                    {profile.notes_root}
                  </span>
                </button>
                {isActive ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={profilesBusy}
                    onClick={() => void onMoveActiveFolder()}
                  >
                    Move…
                  </Button>
                ) : profiles.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Remove from list"
                    disabled={profilesBusy}
                    onClick={() => void onRemoveFolder(profile.id, profile.notes_root)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
        <SettingsActionRow>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={profilesBusy}
            onClick={() => void onAddFolder()}
          >
            <FolderPlus aria-hidden="true" />
            Add folder…
          </Button>
        </SettingsActionRow>
        <SettingsHelpText>
          A working folder is a plain folder of Markdown notes (and a git repo
          when sync is connected). Removing one only takes it off this list —
          the files stay on disk.
        </SettingsHelpText>
        {profilesError ? <SettingsErrorText>{profilesError}</SettingsErrorText> : null}
      </SettingsCard>

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
    </SettingsSection>
  );
}
