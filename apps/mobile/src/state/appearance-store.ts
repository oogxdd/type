// Device-local visual preferences. Unlike every other store in src/state this
// one never touches the Rust core: appearance belongs to the phone, so it
// persists to a small JSON file beside the core's app data (never inside a
// notes root, so it cannot end up in a git sync).

import * as FileSystem from "expo-file-system/legacy";
import { create } from "zustand";

import {
  clampFontSize,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  type Appearance,
  type BackgroundId,
  type FontFamilyId,
  type TextColorId,
} from "../lib/appearance";

// Mirrors core/boot.ts: the core's app_data_dir is `<documents>/typenotes`.
const APPEARANCE_DIR = `${FileSystem.documentDirectory ?? ""}typenotes`;
const APPEARANCE_FILE = `${APPEARANCE_DIR}/appearance.json`;

type AppearanceState = {
  appearance: Appearance;
  /** False until the persisted file has been read (or found missing). */
  hydrated: boolean;
  load: () => Promise<void>;
  setBackground: (background: BackgroundId) => void;
  setTextColor: (textColor: TextColorId) => void;
  setFontSize: (fontSize: number) => void;
  setFontFamily: (fontFamily: FontFamilyId) => void;
  reset: () => void;
};

const persist = async (appearance: Appearance) => {
  try {
    await FileSystem.makeDirectoryAsync(APPEARANCE_DIR, { intermediates: true });
    await FileSystem.writeAsStringAsync(
      APPEARANCE_FILE,
      JSON.stringify(appearance)
    );
  } catch {
    // A failed write only costs the preference on the next launch — never
    // worth interrupting the UI over.
  }
};

// Writes are fire-and-forget and coalesced: holding the font-size stepper
// should not queue one file write per tap. The whole value is captured each
// time, so the last scheduled write is always the complete current state.
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleSave = (appearance: Appearance) => {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist(appearance);
  }, 150);
};

export const useAppearanceStore = create<AppearanceState>((set, get) => {
  const update = (patch: Partial<Appearance>) => {
    const appearance = { ...get().appearance, ...patch };
    set({ appearance });
    scheduleSave(appearance);
  };

  return {
    appearance: DEFAULT_APPEARANCE,
    hydrated: false,

    load: async () => {
      try {
        const info = await FileSystem.getInfoAsync(APPEARANCE_FILE);
        if (info.exists) {
          const raw = await FileSystem.readAsStringAsync(APPEARANCE_FILE);
          set({ appearance: normalizeAppearance(JSON.parse(raw)) });
        }
      } catch {
        // Missing, unreadable, or corrupt: fall back to defaults rather than
        // failing boot over a cosmetic preference.
      } finally {
        set({ hydrated: true });
      }
    },

    setBackground: (background) => update({ background }),
    setTextColor: (textColor) => update({ textColor }),
    setFontSize: (fontSize) => update({ fontSize: clampFontSize(fontSize) }),
    setFontFamily: (fontFamily) => update({ fontFamily }),

    reset: () => {
      set({ appearance: DEFAULT_APPEARANCE });
      scheduleSave(DEFAULT_APPEARANCE);
    },
  };
});
