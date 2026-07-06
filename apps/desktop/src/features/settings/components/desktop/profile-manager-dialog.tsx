import { useEffect, useState } from "react";
import type { NotesProfileSnapshot } from "@typenotes/shared/types";
import { confirmAction } from "@/shared/lib/dom";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsField,
} from "../settings-ui";

type ProfileManagerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: NotesProfileSnapshot["profiles"];
  activeProfileId: string | null;
  profilesBusy: boolean;
  switchProfile: (profileId: string) => Promise<void>;
  createProfile: (input?: { name?: string; description?: string }) => Promise<void>;
  updateProfile: (
    profileId: string,
    patch: { name?: string; description?: string }
  ) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
};

export function ProfileManagerDialog({
  open,
  onOpenChange,
  profiles,
  activeProfileId,
  profilesBusy,
  switchProfile,
  createProfile,
  updateProfile,
  deleteProfile,
}: ProfileManagerDialogProps) {
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDescription, setNewProfileDescription] = useState("");
  const [profileDrafts, setProfileDrafts] = useState<
    Record<string, { name: string; description: string }>
  >({});

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

  const createProfileDisabled = profilesBusy || !newProfileName.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage profiles</DialogTitle>
          <DialogDescription>
            Create, rename, and remove profiles. Deleting a profile keeps its notes folder on disk.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <SettingsCard title="Create profile">
            <SettingsField label="Name">
              <Input
                type="text"
                value={newProfileName}
                onChange={(event) => setNewProfileName(event.target.value)}
                placeholder="Work"
              />
            </SettingsField>
            <SettingsField label="Description">
              <Input
                type="text"
                value={newProfileDescription}
                onChange={(event) => setNewProfileDescription(event.target.value)}
                placeholder="Short label for this profile"
              />
            </SettingsField>
            <SettingsActionRow>
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
            </SettingsActionRow>
          </SettingsCard>

          <SettingsCard title="Existing profiles">
            {profiles.map((profile) => {
              const draft = profileDrafts[profile.id] ?? {
                name: profile.name,
                description: profile.description ?? "",
              };
              const hasDraftChanges =
                draft.name !== profile.name ||
                draft.description !== (profile.description ?? "");
              return (
                <div
                  key={profile.id}
                  className="space-y-3 rounded-md border border-border/50 bg-background/40 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
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
                  <SettingsField label="Name">
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
                  </SettingsField>
                  <SettingsField label="Description">
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
                  </SettingsField>
                  <SettingsActionRow>
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
                      onClick={async () => {
                        if (!(await confirmAction(`Delete profile "${profile.name}"?`))) {
                          return;
                        }
                        void deleteProfile(profile.id);
                      }}
                    >
                      Delete
                    </Button>
                  </SettingsActionRow>
                </div>
              );
            })}
          </SettingsCard>
        </div>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
