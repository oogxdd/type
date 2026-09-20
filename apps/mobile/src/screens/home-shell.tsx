import { createContext, useContext } from "react";
import type { Gesture } from "react-native-gesture-handler";
import type { SharedValue } from "react-native-reanimated";
import type { SwipeDirection } from "../lib/capture-gesture";

type NativeGesture = ReturnType<typeof Gesture.Native>;

export type HomeShell = {
  menuVisible: boolean;
  menuProgress: SharedValue<number>;
  direction: SharedValue<SwipeDirection>;
  dragging: SharedValue<boolean>;
  pull: SharedValue<number>;
  pullReady: SharedValue<boolean>;
  transitioning: SharedValue<boolean>;
  commitRequest: SharedValue<number>;
  // The finger's vertical speed at the moment of release, handed to the commit
  // spring so the page keeps moving at the speed it was thrown.
  commitVelocity: SharedValue<number>;
  suppressPressUntil: SharedValue<number>;
  captureScroll: NativeGesture;
  feedScroll: NativeGesture;
  folderScroll: NativeGesture;
  openMenu: () => void;
  openCapture: () => void;
};

const HomeShellContext = createContext<HomeShell | null>(null);
export const HomeShellProvider = HomeShellContext.Provider;
export const useHomeShell = (): HomeShell => {
  const shell = useContext(HomeShellContext);
  if (!shell) throw new Error("useHomeShell must be called inside HomeScreen");
  return shell;
};
