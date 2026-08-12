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
    trustedSshHost?: string | null;
    trustedSshHostKeySha256?: string | null;
    irohTicket?: string | null;
  }) => Promise<void>;
  saveAssemblyAiKey: (key: string) => Promise<void>;
};

const redactRemoteForLog = (remote: string | null | undefined): string => {
  if (!remote) return "<none>";
  const match = remote.match(/^([a-z][a-z0-9+.-]*:\/\/)([^@/?#]+)@(.+)$/i);
  if (!match) return remote;
  const [, scheme, userinfo, rest] = match;
  if (scheme.toLowerCase() === "ssh://" && userinfo.toLowerCase().startsWith("pair-")) {
    const token = userinfo.slice("pair-".length);
    return `${scheme}pair-<token:${token.slice(-6)}>@${rest}`;
  }
  return `${scheme}${userinfo.includes(":") ? "<credentials>" : userinfo}@${rest}`;
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

    saveGitSettings: ({
      remoteUrl,
      branch,
      username,
      password,
      commitMessage,
      trustedSshHost,
      trustedSshHostKeySha256,
      irohTicket,
    }) =>
      guarded(async () => {
        console.log(
          `[settings] saving git settings remote=${redactRemoteForLog(remoteUrl)} branch=${branch}`
        );
        await withActiveSettings((settings) => ({
          ...settings,
          git_remote_url: remoteUrl,
          git_branch: branch,
          git_username: username,
          git_password: password,
          git_commit_message: commitMessage,
          git_trusted_ssh_host:
            trustedSshHost === undefined ? settings.git_trusted_ssh_host : trustedSshHost ?? "",
          git_trusted_ssh_host_key_sha256:
            trustedSshHostKeySha256 === undefined
              ? settings.git_trusted_ssh_host_key_sha256
              : trustedSshHostKeySha256 ?? "",
          git_iroh_ticket:
            irohTicket === undefined ? settings.git_iroh_ticket : irohTicket ?? "",
        }));
        const saved = activeProfile(get().snapshot)?.settings.git_remote_url;
        console.log(`[settings] saved git settings remote=${redactRemoteForLog(saved)}`);
      }),

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
