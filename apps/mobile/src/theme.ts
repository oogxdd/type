// The theme is derived, not fixed: the system light/dark palettes are only the
// starting point, and the user's device-local appearance preferences
// (background, text color, editor font size) are folded in. The palette and
// the derivation rules live in lib/appearance.ts, which is pure and tested.

import { useMemo } from "react";
import { Platform, useColorScheme } from "react-native";

import { deriveTheme, type Theme } from "./lib/appearance";
import { useAppearanceStore } from "./state/appearance-store";

export type { Theme };

export const useTheme = (): Theme => {
  const scheme = useColorScheme();
  const appearance = useAppearanceStore((state) => state.appearance);
  return useMemo(
    () =>
      deriveTheme(
        appearance,
        scheme === "dark",
        Platform.OS === "android" || Platform.OS === "web" ? Platform.OS : "ios"
      ),
    [appearance, scheme]
  );
};
