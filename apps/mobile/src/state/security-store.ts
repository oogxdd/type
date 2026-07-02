import { create } from "zustand";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import type { SecurityState } from "@typenotes/shared/types";

import { useNotesStore } from "./notes-store";
import { useSettingsStore } from "./settings-store";

type SecurityStoreState = {
  state: SecurityState | null;
  error: string | null;
  busy: boolean;
  load: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => Promise<void>;
};

/** Locked = encryption is on and the in-memory key is absent. */
export const isLocked = (state: SecurityState | null) =>
  Boolean(state?.encryption_enabled && state.locked);

export const useSecurityStore = create<SecurityStoreState>((set) => ({
  state: null,
  error: null,
  busy: false,

  load: async () => {
    try {
      set({ state: await core.getSecurityState(), error: null });
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  unlock: async (password) => {
    set({ busy: true, error: null });
    try {
      const result = await core.unlockSecurity({ password });
      if (result.panic_triggered) {
        // Local data was wiped and reseeded (exactly as on desktop). Reload
        // everything so the UI shows the fresh state.
        set({ state: await core.getSecurityState() });
        await useSettingsStore.getState().load();
        await useNotesStore.getState().refresh();
        return;
      }
      if (!result.unlocked) {
        set({ error: result.message ?? "Invalid password." });
        return;
      }
      set({ state: await core.getSecurityState() });
      await useSettingsStore.getState().load();
      await useNotesStore.getState().refresh();
    } catch (error) {
      set({ error: getErrorMessage(error) });
    } finally {
      set({ busy: false });
    }
  },

  lock: async () => {
    try {
      set({ state: await core.lockSecurity(), error: null });
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },
}));
