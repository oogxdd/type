import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import * as api from "../data/profilesApi";
import type { NotesProfileSnapshot, ProfileSyncSettings } from "../types";
import {
  DEFAULT_PROFILE_SYNC_SETTINGS,
  getProfileSyncSettings,
  removeProfileSyncSettings,
  readProfileSyncStore,
  writeProfileSyncStore,
} from "../utils/storage";

type ProfilesContextValue = {
  profilesSnapshot: NotesProfileSnapshot | null;
  profilesBusy: boolean;
  profilesError: string | null;
  profiles: NotesProfileSnapshot["profiles"];
  activeProfileId: string | null;
  activeProfileNotesRoot: string | null;
  syncSettings: ProfileSyncSettings;
  updateSyncSettings: (patch: Partial<ProfileSyncSettings>) => void;
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
  const [syncSettings, setSyncSettings] = useState<ProfileSyncSettings>(DEFAULT_PROFILE_SYNC_SETTINGS);
  const [syncSettingsProfileId, setSyncSettingsProfileId] = useState<string | null>(null);

  const profiles = profilesSnapshot?.profiles ?? [];
  const activeProfileId = profilesSnapshot?.activeProfileId ?? null;
  const activeProfileNotesRoot =
    profiles.find((profile) => profile.id === activeProfileId)?.notes_root ?? null;

  const refreshProfiles = useCallback(async () => {
    const snapshot = await api.getProfiles();
    setProfilesSnapshot(snapshot);
    return snapshot;
  }, []);

  const updateSyncSettings = useCallback((patch: Partial<ProfileSyncSettings>) => {
    setSyncSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // Load sync settings when active profile changes
  useEffect(() => {
    if (!activeProfileId) {
      return;
    }
    const settings = getProfileSyncSettings(activeProfileId);
    setSyncSettings(settings);
    setSyncSettingsProfileId(activeProfileId);
  }, [activeProfileId]);

  // Persist sync settings when they change
  useEffect(() => {
    if (!activeProfileId || syncSettingsProfileId !== activeProfileId) {
      return;
    }
    const store = readProfileSyncStore();
    store[activeProfileId] = syncSettings;
    writeProfileSyncStore(store);
  }, [activeProfileId, syncSettings, syncSettingsProfileId]);

  // Initial fetch
  useEffect(() => {
    void (async () => {
      setProfilesBusy(true);
      try {
        await refreshProfiles();
        setProfilesError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setProfilesError(message);
      } finally {
        setProfilesBusy(false);
      }
    })();
  }, [refreshProfiles]);

  const switchProfile = useCallback(
    async (profileId: string) => {
      const normalizedId = profileId.trim();
      if (!normalizedId || normalizedId === activeProfileId) {
        return;
      }
      setProfilesBusy(true);
      try {
        if (flushSaveRef.current) {
          await flushSaveRef.current();
        }
        const snapshot = await api.setActiveProfile(normalizedId);
        setProfilesSnapshot(snapshot);
        setProfilesError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setProfilesError(message);
      } finally {
        setProfilesBusy(false);
      }
    },
    [activeProfileId, flushSaveRef]
  );

  const createProfile = useCallback(
    async (input?: { name?: string; description?: string }) => {
      const existingNames = new Set(
        profiles.map((profile) => profile.name.trim().toLowerCase())
      );
      let index = 1;
      let fallbackName = "Profile";
      while (existingNames.has(fallbackName.toLowerCase())) {
        index += 1;
        fallbackName = `Profile ${index}`;
      }
      const name = input?.name?.trim() || fallbackName;
      const description = input?.description?.trim() ?? "";

      setProfilesBusy(true);
      try {
        if (flushSaveRef.current) {
          await flushSaveRef.current();
        }
        const snapshot = await api.createProfile(name, description);
        setProfilesSnapshot(snapshot);
        setProfilesError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setProfilesError(message);
      } finally {
        setProfilesBusy(false);
      }
    },
    [flushSaveRef, profiles]
  );

  const updateProfile = useCallback(
    async (profileId: string, patch: { name?: string; description?: string }) => {
      const normalizedProfileId = profileId.trim();
      if (!normalizedProfileId) {
        return;
      }
      setProfilesBusy(true);
      try {
        if (flushSaveRef.current) {
          await flushSaveRef.current();
        }
        const snapshot = await api.updateProfile(normalizedProfileId, patch);
        setProfilesSnapshot(snapshot);
        setProfilesError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setProfilesError(message);
      } finally {
        setProfilesBusy(false);
      }
    },
    [flushSaveRef]
  );

  const deleteProfile = useCallback(
    async (profileId: string) => {
      const normalizedProfileId = profileId.trim();
      if (!normalizedProfileId) {
        return;
      }
      setProfilesBusy(true);
      try {
        if (flushSaveRef.current) {
          await flushSaveRef.current();
        }
        const snapshot = await api.deleteProfile(normalizedProfileId);
        removeProfileSyncSettings(normalizedProfileId);
        setProfilesSnapshot(snapshot);
        setProfilesError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setProfilesError(message);
      } finally {
        setProfilesBusy(false);
      }
    },
    [flushSaveRef]
  );

  const setProfileNotesRoot = useCallback(
    async (profileId: string, notesRoot: string) => {
      const normalizedProfileId = profileId.trim();
      const normalizedRoot = notesRoot.trim();
      if (!normalizedProfileId || !normalizedRoot) {
        return;
      }
      setProfilesBusy(true);
      try {
        if (flushSaveRef.current) {
          await flushSaveRef.current();
        }
        const snapshot = await api.setProfileNotesRoot(normalizedProfileId, normalizedRoot);
        setProfilesSnapshot(snapshot);
        setProfilesError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setProfilesError(message);
      } finally {
        setProfilesBusy(false);
      }
    },
    [flushSaveRef]
  );

  return (
    <ProfilesContext.Provider
      value={{
        profilesSnapshot,
        profilesBusy,
        profilesError,
        profiles,
        activeProfileId,
        activeProfileNotesRoot,
        syncSettings,
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
