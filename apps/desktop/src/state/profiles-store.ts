// Profiles domain store: working-folder list, active profile, app config.
// State lives in a zustand store; actions are plain async module functions so
// any code (React or not) can drive profile workflows without hook plumbing.
import { create } from "zustand";

import * as api from "@/api/profiles-api";
import {
  LEGACY_PROFILE_SYNC_STORAGE_KEYS,
  profileSyncSettingsFromState,
  splitProfileSyncSettingsPatch,
} from "@/lib/profile-sync-settings";
import { PROFILE_SYNC_STORAGE_KEY } from "@/lib/constants";
import { memoizeOne } from "@/lib/memoize";
import {
  getProfileSyncSettings,
  readProfileSyncStore,
} from "@/lib/storage";
import { getErrorMessage } from "@typenotes/shared/errors";
import type {
  AppConfig,
  NotesProfile,
  NotesProfileSnapshot,
  ProfileSettings,
  ProfileSyncSettings,
} from "@typenotes/shared/types";

type ProfilesState = {
  snapshot: NotesProfileSnapshot | null;
  busy: boolean;
  error: string | null;
};

export const useProfilesStore = create<ProfilesState>(() => ({
  snapshot: null,
  busy: false,
  error: null,
}));

// ---- derived state (shared, memoized per snapshot identity) ----

const EMPTY_PROFILES: NotesProfile[] = [];

const getActiveProfile = memoizeOne(
  (snapshot: NotesProfileSnapshot | null): NotesProfile | null => {
    if (!snapshot) return null;
    return (
      snapshot.profiles.find((profile) => profile.id === snapshot.activeProfileId) ??
      null
    );
  }
);

const getSyncSettings = memoizeOne(
  (appConfig: AppConfig | null, settings: ProfileSettings | null) =>
    profileSyncSettingsFromState(appConfig, settings)
);

export const selectProfiles = (state: ProfilesState): NotesProfile[] =>
  state.snapshot?.profiles ?? EMPTY_PROFILES;
export const selectActiveProfileId = (state: ProfilesState): string | null =>
  state.snapshot?.activeProfileId ?? null;
export const selectActiveProfile = (state: ProfilesState): NotesProfile | null =>
  getActiveProfile(state.snapshot);
export const selectActiveProfileNotesRoot = (state: ProfilesState): string | null =>
  selectActiveProfile(state)?.notes_root ?? null;
export const selectActiveProfileSettings = (
  state: ProfilesState
): ProfileSettings | null => selectActiveProfile(state)?.settings ?? null;
export const selectAppConfig = (state: ProfilesState): AppConfig | null =>
  state.snapshot?.appConfig ?? null;
export const selectSyncSettings = (state: ProfilesState): ProfileSyncSettings =>
  getSyncSettings(selectAppConfig(state), selectActiveProfileSettings(state));

// ---- actions ----

// Editor flush seam: profile mutations can swap the active notes root, so
// pending editor saves must hit disk before the backend mutates state. The
// editor registers its flush here (breaking what used to be a ref threaded
// through the provider tree).
let flushEditorSaves: () => Promise<void> = async () => {};
export const registerProfileMutationFlush = (flush: () => Promise<void>) => {
  flushEditorSaves = flush;
};

export async function refreshProfiles(): Promise<NotesProfileSnapshot> {
  const snapshot = await api.getProfiles();
  useProfilesStore.setState({ snapshot });
  return snapshot;
}

async function runProfileMutation(mutate: () => Promise<NotesProfileSnapshot>) {
  useProfilesStore.setState({ busy: true });
  try {
    await flushEditorSaves();
    const snapshot = await mutate();
    useProfilesStore.setState({ snapshot, error: null });
  } catch (error) {
    useProfilesStore.setState({ error: getErrorMessage(error) });
  } finally {
    useProfilesStore.setState({ busy: false });
  }
}

export async function updateAppConfig(patch: Partial<AppConfig>) {
  const appConfig = selectAppConfig(useProfilesStore.getState());
  if (!appConfig) return;
  await runProfileMutation(() => api.updateAppConfig({ ...appConfig, ...patch }));
}

export async function updateActiveProfileSettings(patch: Partial<ProfileSettings>) {
  const state = useProfilesStore.getState();
  const activeProfileId = selectActiveProfileId(state);
  const activeProfileSettings = selectActiveProfileSettings(state);
  if (!activeProfileId || !activeProfileSettings) return;
  await runProfileMutation(() =>
    api.updateProfileSettings(activeProfileId, {
      ...activeProfileSettings,
      ...patch,
    })
  );
}

export async function updateSyncSettings(patch: Partial<ProfileSyncSettings>) {
  const { appConfigPatch, profileSettingsPatch } =
    splitProfileSyncSettingsPatch(patch);

  if (Object.keys(appConfigPatch).length > 0) {
    await updateAppConfig(appConfigPatch);
  }
  if (Object.keys(profileSettingsPatch).length > 0) {
    await updateActiveProfileSettings(profileSettingsPatch);
  }
}

export async function switchProfile(profileId: string) {
  const normalizedId = profileId.trim();
  if (
    !normalizedId ||
    normalizedId === selectActiveProfileId(useProfilesStore.getState())
  ) {
    return;
  }
  await runProfileMutation(() => api.setActiveProfile(normalizedId));
}

/** Last path segment — how a working folder is displayed everywhere. */
export const folderDisplayName = (root: string) =>
  root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || root;

/**
 * A profile is just a working folder. Adding one means: register a profile
 * named after the directory, then point its notes root at that directory
 * (the backend adopts existing content and ensures the system folders).
 */
export async function addWorkingFolder(directory: string) {
  const normalizedDirectory = directory.trim();
  if (!normalizedDirectory) return;
  const name = folderDisplayName(normalizedDirectory);
  await runProfileMutation(async () => {
    const created = await api.createProfile(name, "");
    return api.setProfileNotesRoot(created.activeProfileId, normalizedDirectory);
  });
}

export async function deleteProfile(profileId: string) {
  const normalizedProfileId = profileId.trim();
  if (!normalizedProfileId) return;
  await runProfileMutation(() => api.deleteProfile(normalizedProfileId));
}

export async function setProfileNotesRoot(profileId: string, notesRoot: string) {
  const normalizedProfileId = profileId.trim();
  const normalizedRoot = notesRoot.trim();
  if (!normalizedProfileId || !normalizedRoot) return;
  await runProfileMutation(() =>
    api.setProfileNotesRoot(normalizedProfileId, normalizedRoot)
  );
}

// Old builds stored one mixed sync-settings blob in localStorage. The backend
// now keeps app-wide provider settings separately from per-profile git
// settings, so migrate the first app config and then each profile.
async function migrateLegacyProfileSyncSettings() {
  const store = readProfileSyncStore();
  if (Object.keys(store).length === 0) return;

  useProfilesStore.setState({ busy: true });
  try {
    const state = useProfilesStore.getState();
    const firstProfileId =
      selectActiveProfileId(state) || Object.keys(store)[0];
    const firstSettings = getProfileSyncSettings(firstProfileId);

    await api.updateAppConfig({
      assemblyai_api_key: firstSettings.assemblyAiApiKey,
      whisper_model: firstSettings.whisperModel,
      handwriting_ocr_provider: firstSettings.handwritingOcrProvider,
      local_ocr_model_path: firstSettings.localOcrModelPath,
      openai_api_key: firstSettings.openAiApiKey,
      openai_model: firstSettings.openAiModel,
      huggingface_api_key: firstSettings.huggingFaceApiKey,
      huggingface_model: firstSettings.huggingFaceModel,
      note_file_name_format: firstSettings.noteFileNameFormat,
    });

    for (const profile of selectProfiles(state)) {
      const settings = store[profile.id];
      if (settings) {
        await api.updateProfileSettings(profile.id, {
          git_remote_url: settings.gitRemoteUrl ?? "",
          git_branch: settings.gitBranch ?? "main",
          git_username: settings.gitUsername ?? "",
          git_password: settings.gitPassword ?? "",
          git_commit_message: settings.gitCommitMessage ?? "Sync notes",
          git_trusted_ssh_host: "",
          git_trusted_ssh_host_key_sha256: "",
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
    useProfilesStore.setState({ busy: false });
  }
}

/** Initial load (or reload after an unlock). Safe to call repeatedly. */
export async function initProfiles() {
  useProfilesStore.setState({ busy: true });
  try {
    await refreshProfiles();
    useProfilesStore.setState({ error: null });
  } catch (error) {
    useProfilesStore.setState({ error: getErrorMessage(error) });
    return;
  } finally {
    useProfilesStore.setState({ busy: false });
  }
  await migrateLegacyProfileSyncSettings();
}
