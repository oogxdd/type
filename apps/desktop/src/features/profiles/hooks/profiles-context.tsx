import {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import type {
  AppConfig,
  NotesProfileSnapshot,
  ProfileSettings,
  ProfileSyncSettings,
} from "@/shared/types";
import { profileSyncSettingsFromState } from "@/features/profiles/lib/profile-sync-settings";
import { getErrorMessage } from "@/shared/lib/errors";
import { useLegacyProfileSyncMigration } from "./use-legacy-profile-sync-migration";
import { useProfileActions } from "./use-profile-actions";

type ProfilesContextValue = {
  profilesSnapshot: NotesProfileSnapshot | null;
  profilesBusy: boolean;
  profilesError: string | null;
  profiles: NotesProfileSnapshot["profiles"];
  activeProfileId: string | null;
  activeProfileNotesRoot: string | null;
  appConfig: AppConfig | null;
  activeProfileSettings: ProfileSettings | null;
  syncSettings: ProfileSyncSettings;
  updateAppConfig: (patch: Partial<AppConfig>) => Promise<void>;
  updateActiveProfileSettings: (patch: Partial<ProfileSettings>) => Promise<void>;
  updateSyncSettings: (patch: Partial<ProfileSyncSettings>) => Promise<void>;
  refreshProfiles: () => Promise<NotesProfileSnapshot>;
  switchProfile: (profileId: string) => Promise<void>;
  createProfile: (input?: { name?: string; description?: string }) => Promise<void>;
  updateProfile: (
    profileId: string,
    patch: { name?: string; description?: string }
  ) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  setProfileNotesRoot: (profileId: string, notesRoot: string) => Promise<void>;
  flushSaveRef: React.RefObject<(() => Promise<void>) | null>;
};

const ProfilesContext = createContext<ProfilesContextValue | null>(null);

export function ProfilesProvider({
  children,
  flushSaveRef,
}: {
  children: ReactNode;
  flushSaveRef: React.RefObject<(() => Promise<void>) | null>;
}) {
  const [profilesSnapshot, setProfilesSnapshot] = useState<NotesProfileSnapshot | null>(null);
  const [profilesBusy, setProfilesBusy] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);

  const profiles = profilesSnapshot?.profiles ?? [];
  const activeProfileId = profilesSnapshot?.activeProfileId ?? null;
  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId]
  );
  const activeProfileNotesRoot = activeProfile?.notes_root ?? null;
  const activeProfileSettings = activeProfile?.settings ?? null;
  const appConfig = profilesSnapshot?.appConfig ?? null;

  // The UI still consumes one settings object; the helper documents which
  // fields are app-wide and which belong to the active profile.
  const syncSettings = useMemo((): ProfileSyncSettings => {
    return profileSyncSettingsFromState(appConfig, activeProfileSettings);
  }, [appConfig, activeProfileSettings]);
  const {
    refreshProfiles,
    updateAppConfig,
    updateActiveProfileSettings,
    updateSyncSettings,
    switchProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    setProfileNotesRoot,
  } = useProfileActions({
    appConfig,
    activeProfileId,
    activeProfileSettings,
    profiles,
    flushSaveRef,
    setProfilesSnapshot,
    setProfilesBusy,
    setProfilesError,
  });

  useLegacyProfileSyncMigration({
    profilesSnapshot,
    profilesBusy,
    activeProfileId,
    profiles,
    refreshProfiles,
    setProfilesBusy,
  });

  // Initial fetch
  useEffect(() => {
    void (async () => {
      setProfilesBusy(true);
      try {
        await refreshProfiles();
        setProfilesError(null);
      } catch (error) {
        const message = getErrorMessage(error);
        setProfilesError(message);
      } finally {
        setProfilesBusy(false);
      }
    })();
  }, [refreshProfiles]);

  return (
    <ProfilesContext.Provider
      value={{
        profilesSnapshot,
        profilesBusy,
        profilesError,
        profiles,
        activeProfileId,
        activeProfileNotesRoot,
        appConfig,
        activeProfileSettings,
        syncSettings,
        updateAppConfig,
        updateActiveProfileSettings,
        updateSyncSettings,
        refreshProfiles,
        switchProfile,
        createProfile,
        updateProfile,
        deleteProfile,
        setProfileNotesRoot,
        flushSaveRef,
      }}
    >
      {children}
    </ProfilesContext.Provider>
  );
}

export function useProfiles() {
  const context = useContext(ProfilesContext);
  if (!context) {
    throw new Error("useProfiles must be used within a ProfilesProvider");
  }
  return context;
}
