// Device-local UI preferences — never synced and not part of any notes root.
// Persisted as a tiny JSON next to the core's app data
// (<Documents>/typenotes/.ui-prefs.json); loaded once at boot.
//
// `menuSide` is an experiment toggle for which side the menu opens from on
// the capture page (hamburger position + edge-swipe strip + the menu's push
// animation). The menu always pushes OVER the capture page and closes with
// the native swipe from the opposite edge.

import * as FileSystem from "expo-file-system/legacy";
import { create } from "zustand";

export type MenuSide = "left" | "right";

const PREFS_DIR = `${FileSystem.documentDirectory ?? ""}typenotes`;
const PREFS_FILE = `${PREFS_DIR}/.ui-prefs.json`;

type UiPrefsState = {
  menuSide: MenuSide;
  load: () => Promise<void>;
  setMenuSide: (side: MenuSide) => void;
};

const persist = async (prefs: { menuSide: MenuSide }) => {
  try {
    await FileSystem.makeDirectoryAsync(PREFS_DIR, { intermediates: true }).catch(
      () => {}
    );
    await FileSystem.writeAsStringAsync(PREFS_FILE, JSON.stringify(prefs));
  } catch {
    // Best effort — worst case the toggle resets on the next launch.
  }
};

export const useUiPrefsStore = create<UiPrefsState>((set, get) => ({
  menuSide: "left",

  load: async () => {
    try {
      const raw = await FileSystem.readAsStringAsync(PREFS_FILE);
      const parsed = JSON.parse(raw) as { menuSide?: unknown };
      if (parsed.menuSide === "left" || parsed.menuSide === "right") {
        set({ menuSide: parsed.menuSide });
      }
    } catch {
      // No prefs file yet (first launch) — keep defaults.
    }
  },

  setMenuSide: (menuSide) => {
    set({ menuSide });
    void persist({ menuSide: get().menuSide });
  },
}));
