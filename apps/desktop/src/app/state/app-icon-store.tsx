import { useEffect, type ReactNode } from "react";
import { create } from "zustand";

import { invokeLogged } from "@/shared/api/invoke";

export const APP_ICON_IDS = [
  "stone",
  "stone-xl",
  "glass",
  "glass-xl",
  "paper",
  "forest",
  "garnet",
  "ice",
  "charcoal",
  "steel",
] as const;

export type AppIconId = (typeof APP_ICON_IDS)[number];

const APP_ICON_STORAGE_KEY = "notes-viewer-app-icon";
const DEFAULT_APP_ICON: AppIconId = "stone";

const isAppIconId = (value: string | null): value is AppIconId =>
  APP_ICON_IDS.some((iconId) => iconId === value);

const getInitialAppIcon = (): AppIconId => {
  if (typeof window === "undefined") {
    return DEFAULT_APP_ICON;
  }
  const stored = window.localStorage.getItem(APP_ICON_STORAGE_KEY);
  return isAppIconId(stored) ? stored : DEFAULT_APP_ICON;
};

const applyNativeAppIcon = (iconId: AppIconId): Promise<void> =>
  invokeLogged<void>("set_app_icon", {
    args: { icon_id: iconId },
  });

type AppIconState = {
  appIcon: AppIconId;
  applyingIcon: AppIconId | null;
  appIconError: string | null;
  setAppIcon: (iconId: AppIconId) => Promise<void>;
  applyCurrentAppIcon: () => Promise<void>;
};

export const useAppIcon = create<AppIconState>((set, get) => {
  const apply = async (iconId: AppIconId, persist: boolean) => {
    set({ applyingIcon: iconId, appIconError: null });
    try {
      await applyNativeAppIcon(iconId);
      if (persist && typeof window !== "undefined") {
        window.localStorage.setItem(APP_ICON_STORAGE_KEY, iconId);
      }
      set({ appIcon: iconId, applyingIcon: null });
    } catch (error) {
      set({
        applyingIcon: null,
        appIconError:
          error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  return {
    appIcon: getInitialAppIcon(),
    applyingIcon: null,
    appIconError: null,
    setAppIcon: (iconId) => apply(iconId, true),
    applyCurrentAppIcon: () => apply(get().appIcon, false),
  };
});

export function AppIconProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    void useAppIcon.getState().applyCurrentAppIcon().catch(() => {
      // The settings card exposes the native error. Startup should continue
      // even on platforms where runtime app-icon switching is unsupported.
    });
  }, []);

  return children;
}
