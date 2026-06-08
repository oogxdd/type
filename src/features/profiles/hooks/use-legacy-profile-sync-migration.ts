import { useEffect } from "react";

import * as api from "@/features/profiles/api/profiles-api";
import { LEGACY_PROFILE_SYNC_STORAGE_KEYS } from "@/features/profiles/lib/profile-sync-settings";
import { PROFILE_SYNC_STORAGE_KEY } from "@/shared/constants";
import {
  getProfileSyncSettings,
  readProfileSyncStore,
} from "@/shared/lib/storage";
import type { NotesProfileSnapshot } from "@/shared/types";

type UseLegacyProfileSyncMigrationArgs = {
  profilesSnapshot: NotesProfileSnapshot | null;
  profilesBusy: boolean;
  activeProfileId: string | null;
  profiles: NotesProfileSnapshot["profiles"];
  refreshProfiles: () => Promise<NotesProfileSnapshot>;
  setProfilesBusy: (busy: boolean) => void;
};

export function useLegacyProfileSyncMigration({
  profilesSnapshot,
  profilesBusy,
  activeProfileId,
  profiles,
  refreshProfiles,
  setProfilesBusy,
}: UseLegacyProfileSyncMigrationArgs) {
  useEffect(() => {
    if (!profilesSnapshot || profilesBusy) return;

    const store = readProfileSyncStore();
    if (Object.keys(store).length === 0) return;

    const migrate = async () => {
      setProfilesBusy(true);
      try {
        // Old builds stored one mixed settings blob in localStorage. The backend
        // now keeps app-wide provider settings separately from per-profile git
        // settings, so migrate the first app config and then each profile.
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
        LEGACY_PROFILE_SYNC_STORAGE_KEYS.forEach((key) =>
          window.localStorage.removeItem(key)
        );

        await refreshProfiles();
      } catch (error) {
        console.error("Profile sync settings migration failed", error);
      } finally {
        setProfilesBusy(false);
      }
    };

    void migrate();
  }, [
    activeProfileId,
    profiles,
    profilesBusy,
    profilesSnapshot,
    refreshProfiles,
    setProfilesBusy,
  ]);
}
