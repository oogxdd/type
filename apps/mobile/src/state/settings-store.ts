import { create } from "zustand";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import type {
  NotesProfile,
  ProfilesSnapshot,
  TranscriptionMode,
} from "@typenotes/shared/types";

type SettingsState = {
  snapshot: ProfilesSnapshot | null;
  demoMode: boolean;
  error: string | null;
  setDemoMode: (demoMode: boolean) => void;
  load: () => Promise<void>;
  createWorkingFolder: (name: string) => Promise<void>;
  switchWorkingFolder: (profileId: string) => Promise<void>;
  setNotesRoot: (profileId: string, notesRoot: string) => Promise<void>;
  setTranscriptionMode: (mode: TranscriptionMode) => Promise<void>;
  saveGitSettings: (settings: {
    remoteUrl: string;
    branch: string;
    username: string;
    password: string;
    commitMessage: string;
  }) => Promise<void>;
  saveAssemblyAiKey: (key: string) => Promise<void>;
};

export const activeProfile = (
  snapshot: ProfilesSnapshot | null
): NotesProfile | null =>
  snapshot?.profiles.find((p) => p.id === snapshot.active_profile_id) ??
  snapshot?.profiles[0] ??
  null;

const applySnapshot =
  (set: (partial: Partial<SettingsState>) => void) =>
  (snapshot: ProfilesSnapshot) =>
    set({ snapshot, error: null });

export const useSettingsStore = create<SettingsState>((set, get) => {
  const apply = applySnapshot(set);

  const withActiveSettings = async (
    mutate: (settings: NotesProfile["settings"]) => NotesProfile["settings"]
  ) => {
    const profile = activeProfile(get().snapshot);
    if (!profile) {
      throw new Error("No active working folder.");
    }
    apply(
      await core.updateProfileSettings({
        profile_id: profile.id,
        settings: mutate(profile.settings),
      })
    );
  };

  const guarded = async (run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      set({ error: getErrorMessage(error) });
      throw error;
    }
  };

  return {
    snapshot: null,
    demoMode: false,
    error: null,

    setDemoMode: (demoMode) => set({ demoMode }),

    load: () =>
      guarded(async () => {
        apply(await core.getProfiles());
      }),

    createWorkingFolder: (name) =>
      guarded(async () => {
        apply(await core.createProfile({ name }));
      }),

    switchWorkingFolder: (profileId) =>
      guarded(async () => {
        apply(await core.setActiveProfile(profileId));
      }),

    setNotesRoot: (profileId, notesRoot) =>
      guarded(async () => {
        apply(await core.setProfileNotesRoot(profileId, notesRoot));
      }),

    setTranscriptionMode: (mode) =>
      guarded(() =>
        withActiveSettings((settings) => ({
          ...settings,
          transcription_mode: mode,
        }))
      ),

    saveGitSettings: ({ remoteUrl, branch, username, password, commitMessage }) =>
      guarded(() =>
        withActiveSettings((settings) => ({
          ...settings,
          git_remote_url: remoteUrl,
          git_branch: branch,
          git_username: username,
          git_password: password,
          git_commit_message: commitMessage,
        }))
      ),

    saveAssemblyAiKey: (key) =>
      guarded(async () => {
        const config = get().snapshot?.app_config;
        if (!config) {
          throw new Error("Settings not loaded yet.");
        }
        apply(await core.updateAppConfig({ ...config, assemblyai_api_key: key }));
      }),
  };
});
