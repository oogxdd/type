import { create } from "zustand";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import type {
  ObjectStoreSettings,
  ObjectSyncStatus,
} from "@typenotes/shared/types";

import { useNotesStore } from "./notes-store";

/** Never log the secret; the endpoint and bucket are the useful part. */
const settingsForLog = (settings: ObjectStoreSettings): string =>
  `endpoint=${settings.endpoint || "<none>"} bucket=${
    settings.bucket || "<none>"
  } prefix=${settings.prefix || "<default>"} enabled=${settings.enabled}`;

const log = (message: string) => console.log(`[object-sync] ${message}`);

export const EMPTY_OBJECT_STORE_SETTINGS: ObjectStoreSettings = {
  endpoint: "",
  bucket: "",
  prefix: "",
  region: "auto",
  access_key_id: "",
  secret_access_key: "",
  force_path_style: null,
  device_id: "",
  enabled: false,
};

type ObjectSyncState = {
  /** False on native modules built before object sync existed. */
  available: boolean;
  status: ObjectSyncStatus | null;
  settings: ObjectStoreSettings;
  busy: boolean;
  error: string | null;
  notice: string | null;
  refresh: () => Promise<void>;
  save: (settings: ObjectStoreSettings) => Promise<void>;
  test: (settings: ObjectStoreSettings) => Promise<void>;
  /** Run a round and wait — pull-to-refresh and the explicit button. */
  syncNow: () => Promise<void>;
};

export const useObjectSyncStore = create<ObjectSyncState>((set, get) => {
  const run = async (action: () => Promise<string | null>) => {
    set({ busy: true, error: null, notice: null });
    try {
      set({ notice: await action() });
    } catch (caught) {
      const message = getErrorMessage(caught);
      log(`failed: ${message}`);
      set({ error: message });
    } finally {
      set({ busy: false });
      await get().refresh();
    }
  };

  return {
    available: core.isObjectSyncAvailable(),
    status: null,
    settings: EMPTY_OBJECT_STORE_SETTINGS,
    busy: false,
    error: null,
    notice: null,

    refresh: async () => {
      if (!core.isObjectSyncAvailable()) {
        set({ available: false });
        return;
      }
      try {
        const [status, settings] = await Promise.all([
          core.getObjectSyncStatus(),
          core.getObjectSyncSettings(),
        ]);
        set({ available: true, status, settings });
      } catch (caught) {
        set({ error: getErrorMessage(caught) });
      }
    },

    save: (settings) =>
      run(async () => {
        log(`saving ${settingsForLog(settings)}`);
        await core.setObjectSyncSettings(settings);
        return "Saved.";
      }),

    test: (settings) =>
      run(async () => {
        log(`testing ${settingsForLog(settings)}`);
        await core.testObjectSyncConnection(settings);
        return "Connection works.";
      }),

    syncNow: () =>
      run(async () => {
        const outcome = await core.objectSyncNow();
        log(
          `round: up=${outcome.uploaded} down=${outcome.downloaded} conflicts=${outcome.conflicts.length}`
        );
        // Downloads land straight in the notes folder behind the UI's back.
        if (outcome.downloaded > 0 || outcome.deleted_local > 0) {
          await useNotesStore.getState().refresh();
        }
        const summary = `${outcome.uploaded} up · ${outcome.downloaded} down`;
        return outcome.conflicts.length > 0
          ? `${summary} · ${outcome.conflicts.length} conflict copies`
          : summary;
      }),
  };
});
