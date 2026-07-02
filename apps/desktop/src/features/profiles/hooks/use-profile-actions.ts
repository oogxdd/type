import { useCallback, type RefObject } from "react";

import * as api from "@/features/profiles/api/profiles-api";
import { splitProfileSyncSettingsPatch } from "@/features/profiles/lib/profile-sync-settings";
import { getErrorMessage } from "@typenotes/shared/errors";
import type {
  AppConfig,
  NotesProfileSnapshot,
  ProfileSettings,
  ProfileSyncSettings,
} from "@typenotes/shared/types";

type UseProfileActionsArgs = {
  appConfig: AppConfig | null;
  activeProfileId: string | null;
  activeProfileSettings: ProfileSettings | null;
  profiles: NotesProfileSnapshot["profiles"];
  flushSaveRef: RefObject<(() => Promise<void>) | null>;
  setProfilesSnapshot: (snapshot: NotesProfileSnapshot) => void;
  setProfilesBusy: (busy: boolean) => void;
  setProfilesError: (error: string | null) => void;
};

export function useProfileActions({
  appConfig,
  activeProfileId,
  activeProfileSettings,
  profiles,
  flushSaveRef,
  setProfilesSnapshot,
  setProfilesBusy,
  setProfilesError,
}: UseProfileActionsArgs) {
  const refreshProfiles = useCallback(async () => {
    const snapshot = await api.getProfiles();
    setProfilesSnapshot(snapshot);
    return snapshot;
  }, [setProfilesSnapshot]);

  const runProfileMutation = useCallback(
    async (mutate: () => Promise<NotesProfileSnapshot>) => {
      setProfilesBusy(true);
      try {
        // Profile changes can swap the active notes root, so pending editor
        // saves must hit disk before the backend mutates profile state.
        if (flushSaveRef.current) {
          await flushSaveRef.current();
        }
        const snapshot = await mutate();
        setProfilesSnapshot(snapshot);
        setProfilesError(null);
      } catch (error) {
        setProfilesError(getErrorMessage(error));
      } finally {
        setProfilesBusy(false);
      }
    },
    [flushSaveRef, setProfilesBusy, setProfilesError, setProfilesSnapshot]
  );

  const updateAppConfig = useCallback(
    async (patch: Partial<AppConfig>) => {
      if (!appConfig) return;
      await runProfileMutation(() => api.updateAppConfig({ ...appConfig, ...patch }));
    },
    [appConfig, runProfileMutation]
  );

  const updateActiveProfileSettings = useCallback(
    async (patch: Partial<ProfileSettings>) => {
      if (!activeProfileId || !activeProfileSettings) return;
      await runProfileMutation(() =>
        api.updateProfileSettings(activeProfileId, {
          ...activeProfileSettings,
          ...patch,
        })
      );
    },
    [activeProfileId, activeProfileSettings, runProfileMutation]
  );

  const updateSyncSettings = useCallback(
    async (patch: Partial<ProfileSyncSettings>) => {
      const { appConfigPatch, profileSettingsPatch } =
        splitProfileSyncSettingsPatch(patch);

      if (Object.keys(appConfigPatch).length > 0) {
        await updateAppConfig(appConfigPatch);
      }
      if (Object.keys(profileSettingsPatch).length > 0) {
        await updateActiveProfileSettings(profileSettingsPatch);
      }
    },
    [updateAppConfig, updateActiveProfileSettings]
  );

  const switchProfile = useCallback(
    async (profileId: string) => {
      const normalizedId = profileId.trim();
      if (!normalizedId || normalizedId === activeProfileId) {
        return;
      }
      await runProfileMutation(() => api.setActiveProfile(normalizedId));
    },
    [activeProfileId, runProfileMutation]
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
      await runProfileMutation(() => api.createProfile(name, description));
    },
    [profiles, runProfileMutation]
  );

  const updateProfile = useCallback(
    async (profileId: string, patch: { name?: string; description?: string }) => {
      const normalizedProfileId = profileId.trim();
      if (!normalizedProfileId) {
        return;
      }
      await runProfileMutation(() => api.updateProfile(normalizedProfileId, patch));
    },
    [runProfileMutation]
  );

  const deleteProfile = useCallback(
    async (profileId: string) => {
      const normalizedProfileId = profileId.trim();
      if (!normalizedProfileId) {
        return;
      }
      await runProfileMutation(() => api.deleteProfile(normalizedProfileId));
    },
    [runProfileMutation]
  );

  const setProfileNotesRoot = useCallback(
    async (profileId: string, notesRoot: string) => {
      const normalizedProfileId = profileId.trim();
      const normalizedRoot = notesRoot.trim();
      if (!normalizedProfileId || !normalizedRoot) {
        return;
      }
      await runProfileMutation(() =>
        api.setProfileNotesRoot(normalizedProfileId, normalizedRoot)
      );
    },
    [runProfileMutation]
  );

  return {
    refreshProfiles,
    updateAppConfig,
    updateActiveProfileSettings,
    updateSyncSettings,
    switchProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    setProfileNotesRoot,
  };
}
