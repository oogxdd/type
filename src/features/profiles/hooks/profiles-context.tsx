import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import * as api from "../api/profiles-api";
import type {
  AppConfig,
  NotesProfileSnapshot,
  ProfileSettings,
  ProfileSyncSettings,
} from "@/shared/types";
import {
  DEFAULT_PROFILE_SYNC_SETTINGS,
  getProfileSyncSettings,
  readProfileSyncStore,
} from "@/shared/lib/storage";
import { PROFILE_SYNC_STORAGE_KEY } from "@/shared/constants";
import { getErrorMessage } from "@/shared/lib/errors";

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

  // Derived legacy settings object for backward compatibility
  const syncSettings = useMemo((): ProfileSyncSettings => {
    if (!appConfig || !activeProfileSettings) {
      return {
        gitRemoteUrl: "",
        gitBranch: "main",
        gitUsername: "",
        gitPassword: "",
        gitCommitMessage: "Sync notes",
        lastSuccessfulSyncAt: "",
        noteFileNameFormat: "utc_timestamp_slug",
        assemblyAiApiKey: "",
        mobileAutoTranscriptionEnabled: true,
        whisperModel: "large-v3",
        handwritingOcrProvider: "openai",
        openAiApiKey: "",
        openAiModel: "gpt-4.1-mini",
        huggingFaceApiKey: "",
        huggingFaceModel: "microsoft/trocr-base-handwritten",
        mobileAutoHandwritingOcrEnabled: true,
      };
    }

    return {
      gitRemoteUrl: activeProfileSettings.git_remote_url,
      gitBranch: activeProfileSettings.git_branch,
      gitUsername: activeProfileSettings.git_username,
      gitPassword: activeProfileSettings.git_password,
      gitCommitMessage: activeProfileSettings.git_commit_message,
      lastSuccessfulSyncAt: "", // Not yet implemented on backend
      noteFileNameFormat: appConfig.note_file_name_format as any,
      assemblyAiApiKey: appConfig.assemblyai_api_key,
      mobileAutoTranscriptionEnabled: activeProfileSettings.mobile_auto_transcription_enabled,
      whisperModel: appConfig.whisper_model,
      handwritingOcrProvider: appConfig.handwriting_ocr_provider as any,
      openAiApiKey: appConfig.openai_api_key,
      openAiModel: appConfig.openai_model,
      huggingFaceApiKey: appConfig.huggingface_api_key,
      huggingFaceModel: appConfig.huggingface_model,
      mobileAutoHandwritingOcrEnabled: activeProfileSettings.mobile_auto_handwriting_ocr_enabled,
    };
  }, [appConfig, activeProfileSettings]);

  const refreshProfiles = useCallback(async () => {
    const snapshot = await api.getProfiles();
    setProfilesSnapshot(snapshot);
    return snapshot;
  }, []);

  const runProfileMutation = useCallback(
    async (
      mutate: () => Promise<NotesProfileSnapshot>,
      onSuccess?: () => void
    ) => {
      setProfilesBusy(true);
      try {
        if (flushSaveRef.current) {
          await flushSaveRef.current();
        }
        const snapshot = await mutate();
        onSuccess?.();
        setProfilesSnapshot(snapshot);
        setProfilesError(null);
      } catch (error) {
        const message = getErrorMessage(error);
        setProfilesError(message);
      } finally {
        setProfilesBusy(false);
      }
    },
    [flushSaveRef]
  );

  const updateAppConfig = useCallback(async (patch: Partial<AppConfig>) => {
    if (!appConfig) return;
    await runProfileMutation(() => api.updateAppConfig({ ...appConfig, ...patch }));
  }, [appConfig, runProfileMutation]);

  const updateActiveProfileSettings = useCallback(async (patch: Partial<ProfileSettings>) => {
    if (!activeProfileId || !activeProfileSettings) return;
    await runProfileMutation(() => 
      api.updateProfileSettings(activeProfileId, { ...activeProfileSettings, ...patch })
    );
  }, [activeProfileId, activeProfileSettings, runProfileMutation]);

  // One-time migration from localStorage to backend
  useEffect(() => {
    if (!profilesSnapshot || profilesBusy) return;

    const store = readProfileSyncStore();
    if (Object.keys(store).length === 0) return;

    const migrate = async () => {
      setProfilesBusy(true);
      try {
        const firstProfileId = activeProfileId || Object.keys(store)[0];
        const firstSettings = getProfileSyncSettings(firstProfileId);

        await api.updateAppConfig({
          assemblyai_api_key: firstSettings.assemblyAiApiKey,
          whisper_model: firstSettings.whisperModel,
          handwriting_ocr_provider: firstSettings.handwritingOcrProvider,
          openai_api_key: firstSettings.openAiApiKey,
          openai_model: firstSettings.openAiModel,
          huggingface_api_key: firstSettings.huggingFaceApiKey,
          huggingface_model: firstSettings.huggingFaceModel,
          note_file_name_format: firstSettings.noteFileNameFormat,
        });

        for (const profile of profiles) {
          const settings = store[profile.id];
          if (settings) {
            await api.updateProfileSettings(profile.id, {
              git_remote_url: settings.gitRemoteUrl ?? "",
              git_branch: settings.gitBranch ?? "main",
              git_username: settings.gitUsername ?? "",
              git_password: settings.gitPassword ?? "",
              git_commit_message: settings.gitCommitMessage ?? "Sync notes",
              mobile_auto_transcription_enabled:
                settings.mobileAutoTranscriptionEnabled ?? true,
              mobile_auto_handwriting_ocr_enabled:
                settings.mobileAutoHandwritingOcrEnabled ?? true,
            });
          }
        }

        window.localStorage.removeItem(PROFILE_SYNC_STORAGE_KEY);
        const legacyKeys = [
          "notes-viewer-git-remote",
          "notes-viewer-git-branch",
          "notes-viewer-git-username",
          "notes-viewer-git-password",
          "notes-viewer-git-commit-message",
          "notes-viewer-git-last-sync-at",
          "notes-viewer-note-file-name-format",
          "notes-viewer-assemblyai-api-key",
          "notes-viewer-mobile-auto-transcription-enabled",
          "notes-viewer-handwriting-ocr-provider",
          "notes-viewer-openai-api-key",
          "notes-viewer-openai-model",
          "notes-viewer-huggingface-api-key",
          "notes-viewer-huggingface-model",
          "notes-viewer-mobile-auto-handwriting-ocr-enabled",
        ];
        legacyKeys.forEach((k) => window.localStorage.removeItem(k));

        await refreshProfiles();
      } catch (e) {
        console.error("Migration failed", e);
      } finally {
        setProfilesBusy(false);
      }
    };

    void migrate();
  }, [
    profilesSnapshot,
    profilesBusy,
    activeProfileId,
    profiles,
    refreshProfiles,
  ]);

  const updateSyncSettings = useCallback(
    async (patch: Partial<ProfileSyncSettings>) => {
      const appConfigPatch: Partial<AppConfig> = {};
      const profileSettingsPatch: Partial<ProfileSettings> = {};

      if ("noteFileNameFormat" in patch)
        appConfigPatch.note_file_name_format = patch.noteFileNameFormat;
      if ("assemblyAiApiKey" in patch)
        appConfigPatch.assemblyai_api_key = patch.assemblyAiApiKey!;
      if ("whisperModel" in patch)
        appConfigPatch.whisper_model = patch.whisperModel!;
      if ("handwritingOcrProvider" in patch)
        appConfigPatch.handwriting_ocr_provider = patch.handwritingOcrProvider!;
      if ("openAiApiKey" in patch)
        appConfigPatch.openai_api_key = patch.openAiApiKey!;
      if ("openAiModel" in patch)
        appConfigPatch.openai_model = patch.openAiModel!;
      if ("huggingFaceApiKey" in patch)
        appConfigPatch.huggingface_api_key = patch.huggingFaceApiKey!;
      if ("huggingFaceModel" in patch)
        appConfigPatch.huggingface_model = patch.huggingFaceModel!;

      if ("gitRemoteUrl" in patch)
        profileSettingsPatch.git_remote_url = patch.gitRemoteUrl!;
      if ("gitBranch" in patch)
        profileSettingsPatch.git_branch = patch.gitBranch!;
      if ("gitUsername" in patch)
        profileSettingsPatch.git_username = patch.gitUsername!;
      if ("gitPassword" in patch)
        profileSettingsPatch.git_password = patch.gitPassword!;
      if ("gitCommitMessage" in patch)
        profileSettingsPatch.git_commit_message = patch.gitCommitMessage!;
      if ("mobileAutoTranscriptionEnabled" in patch)
        profileSettingsPatch.mobile_auto_transcription_enabled =
          patch.mobileAutoTranscriptionEnabled!;
      if ("mobileAutoHandwritingOcrEnabled" in patch)
        profileSettingsPatch.mobile_auto_handwriting_ocr_enabled =
          patch.mobileAutoHandwritingOcrEnabled!;

      if (Object.keys(appConfigPatch).length > 0) {
        await updateAppConfig(appConfigPatch);
      }
      if (Object.keys(profileSettingsPatch).length > 0) {
        await updateActiveProfileSettings(profileSettingsPatch);
      }
    },
    [updateAppConfig, updateActiveProfileSettings]
  );

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
