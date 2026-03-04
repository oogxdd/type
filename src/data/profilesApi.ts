import { invokeLogged } from "./invoke";
import type { NotesProfile, NotesProfileSnapshot } from "../types";

type NotesProfilesSnapshotPayload = {
  active_profile_id: string;
  profiles: NotesProfile[];
};

const normalizeProfilesSnapshot = (
  payload: NotesProfilesSnapshotPayload
): NotesProfileSnapshot => ({
  activeProfileId: payload.active_profile_id,
  profiles: payload.profiles,
});

export const getProfiles = async (): Promise<NotesProfileSnapshot> =>
  normalizeProfilesSnapshot(
    await invokeLogged<NotesProfilesSnapshotPayload>("get_profiles")
  );

export const createProfile = async (
  name: string,
  description?: string
): Promise<NotesProfileSnapshot> =>
  normalizeProfilesSnapshot(
    await invokeLogged<NotesProfilesSnapshotPayload>("create_profile", {
      args: { name, description },
    })
  );

export const setActiveProfile = (
  profileId: string
): Promise<NotesProfileSnapshot> =>
  invokeLogged<NotesProfilesSnapshotPayload>("set_active_profile", {
    args: { profile_id: profileId },
  }).then(normalizeProfilesSnapshot);

export const setProfileNotesRoot = (
  profileId: string,
  notesRoot: string
): Promise<NotesProfileSnapshot> =>
  invokeLogged<NotesProfilesSnapshotPayload>("set_profile_notes_root", {
    args: {
      profile_id: profileId,
      notes_root: notesRoot,
    },
  }).then(normalizeProfilesSnapshot);

export const updateProfile = (
  profileId: string,
  patch: { name?: string; description?: string }
): Promise<NotesProfileSnapshot> =>
  invokeLogged<NotesProfilesSnapshotPayload>("update_profile", {
    args: {
      profile_id: profileId,
      ...patch,
    },
  }).then(normalizeProfilesSnapshot);

export const deleteProfile = (profileId: string): Promise<NotesProfileSnapshot> =>
  invokeLogged<NotesProfilesSnapshotPayload>("delete_profile", {
    args: { profile_id: profileId },
  }).then(normalizeProfilesSnapshot);
