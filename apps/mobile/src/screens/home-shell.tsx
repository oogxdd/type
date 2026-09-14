// The seam between the capture page and the menu behind it.
//
// Capture and Menu used to be two screens of the native stack, which is what
// put react-native-screens' pop recognizer on the capture page — a recognizer
// that fires on ~10pt in any direction, cancels the touch underneath it, and
// cannot be arbitrated with by anything in react-native-gesture-handler (see
// apps/mobile/GESTURES.md). Every threshold in capture-gesture.ts existed to
// survive it.
//
// They are now one screen with two layers, and `menuProgress` is the only
// thing between them: 0 means capture fills the window, 1 means the menu does.
// Nothing navigates, so there is no navigation gesture to lose a race to.

import { createContext, useContext } from "react";
import type { SharedValue } from "react-native-reanimated";

export type HomeShell = {
  /**
   * 0 = capture, 1 = menu. Written from gesture worklets on the UI thread, so
   * both pans drive the transition under the finger without a JS round trip.
   */
  menuProgress: SharedValue<number>;
  /** Animate to the menu (buttons, hardware back). */
  openMenu: () => void;
  /** Animate back to the capture page. */
  openCapture: () => void;
};

const HomeShellContext = createContext<HomeShell | null>(null);

export const HomeShellProvider = HomeShellContext.Provider;

export const useHomeShell = (): HomeShell => {
  const shell = useContext(HomeShellContext);
  if (!shell) {
    throw new Error("useHomeShell must be called inside HomeScreen");
  }
  return shell;
};
