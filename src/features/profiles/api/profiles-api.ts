import { invokeLogged } from "@/shared/api/invoke";
import type {
  AppConfig,
  NotesProfile,
  NotesProfileSnapshot,
  ProfileSettings,
  ProfilesBackupArchive,
  ProfilesDocumentsExport,
} from "@/shared/types";

type NotesProfilesSnapshotPayload = {
  active_profile_id: string;
  profiles: NotesProfile[];
  app_config: AppConfig;
};

const normalizeProfilesSnapshot = (
  payload: NotesProfilesSnapshotPayload
): NotesProfileSnapshot => ({
  activeProfileId: payload.active_profile_id,
  profiles: payload.profiles,
  appConfig: payload.app_config,
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

export const updateProfileSettings = (
  profileId: string,
  settings: ProfileSettings
): Promise<NotesProfileSnapshot> =>
  invokeLogged<NotesProfilesSnapshotPayload>("update_profile_settings", {
    args: {
      profile_id: profileId,
      settings,
    },
  }).then(normalizeProfilesSnapshot);

export const updateAppConfig = (
  config: AppConfig
): Promise<NotesProfileSnapshot> =>
  invokeLogged<NotesProfilesSnapshotPayload>("update_app_config", {
    args: { config },
  }).then(normalizeProfilesSnapshot);

export const createProfilesBackupZip = (): Promise<ProfilesBackupArchive> =>
  invokeLogged<ProfilesBackupArchive>("create_profiles_backup_zip");

export const presentFileExportSheet = (path: string): Promise<void> =>
  invokeLogged("present_file_export_sheet", { path });

export const exportProfilesToDocuments = (): Promise<ProfilesDocumentsExport> =>
  invokeLogged<ProfilesDocumentsExport>("export_profiles_to_documents");
