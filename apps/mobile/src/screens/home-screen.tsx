// The root screen: the menu and the capture page, both mounted for the life of
// the app, with the capture page sliding right to reveal the menu behind it.
//
// This replaces a native-stack push (Menu at the root, Capture above it). The
// push is what put react-native-screens' pop recognizer on the capture page,
// and that recognizer cannot be arbitrated with -- it activates on ~10pt in
// any direction, including straight up, and cancels the touch for everything
// below it. Zoning it by `gestureResponseDistance` was the only lever that
// worked, and it bought consistency by giving up the interactive transition
// over most of the screen.
//
// With Capture no longer pushed there is nothing beneath it in the stack, so
// the recognizer is not in the picture at all and both directions are ours,
// driven under the finger, everywhere.
//
// Mounting the real menu permanently is what makes this affordable. The
// alternative considered in GESTURES.md drew a static replica of the menu
// under the finger and pushed the real screen behind it; it was rejected
// because the replica visibly differs from a live SectionList and because
// mounting a second MenuScreen mid-gesture is expensive. Mounting it once, at
// startup, has neither problem -- and the menu's tab, filter, expanded folders
// and scroll offset now survive every trip, which the push never did.

import { useCallback, useEffect, useMemo } from "react";
import { BackHandler, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "../theme";
import { CaptureScreen } from "./capture-screen";
import { HomeShellProvider, type HomeShell } from "./home-shell";
import { MenuScreen } from "./menu-screen";

/** How far the menu trails the capture page, as a fraction of the window. */
export const MENU_PARALLAX = 0.3;

/** Dim over the menu while the capture page covers it. */
const MENU_DIM = 0.08;

/**
 * The settle animation for a released drag.
 *
 * Deliberately a timing, not a spring: this is the one transition the app now
 * owns that UIKit used to provide, and an overshooting spring on a full-screen
 * translate reads as a bounce rather than a page settling.
 */
const SETTLE = {
  duration: 220,
  easing: Easing.out(Easing.cubic),
} as const;

export const HomeScreen = () => {
  const theme = useTheme();
  const { width } = useWindowDimensions();

  const menuProgress = useSharedValue(0);
  // The gestures below are memoized for the life of the screen, so they cannot
  // close over a prop that changes on rotation.
  const windowW = useSharedValue(width);
  useEffect(() => {
    windowW.value = width;
  }, [width, windowW]);

  const openMenu = useCallback(() => {
    menuProgress.value = withTiming(1, SETTLE);
  }, [menuProgress]);

  const openCapture = useCallback(() => {
    menuProgress.value = withTiming(0, SETTLE);
  }, [menuProgress]);

  // Android's hardware back used to pop Capture and reveal Menu for free.
  // Now it has to be said out loud: from the capture page it opens the menu,
  // and only from the menu does it fall through and leave the app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (menuProgress.value > 0.5) {
          return false;
        }
        openMenu();
        return true;
      }
    );
    return () => subscription.remove();
  }, [menuProgress, openMenu]);

  const menuStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: -windowW.value * MENU_PARALLAX * (1 - menuProgress.value),
      },
    ],
  }));

  const dimStyle = useAnimatedStyle(() => ({
    opacity: MENU_DIM * (1 - menuProgress.value),
  }));

  const captureStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: windowW.value * menuProgress.value }],
  }));

  const shell = useMemo<HomeShell>(
    () => ({ menuProgress, openMenu, openCapture }),
    [menuProgress, openMenu, openCapture]
  );

  return (
    <HomeShellProvider value={shell}>
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <Animated.View style={[StyleSheet.absoluteFill, menuStyle]}>
          <MenuScreen />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.dim, dimStyle]}
        />
        {/* Opaque and full-bleed: at rest it covers the menu completely, so the
            menu never receives a touch meant for the capture page. */}
        <Animated.View style={[StyleSheet.absoluteFill, captureStyle]}>
          <CaptureScreen />
        </Animated.View>
      </View>
    </HomeShellProvider>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  dim: { backgroundColor: "#000" },
});
