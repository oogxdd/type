// Menu and Capture are persistent layers of one route. The native stack has
// no pop recognizer here: one pan owns direction and release for both layers.
import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, Keyboard, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withTiming,
} from "react-native-reanimated";
import {
  menuReleaseTarget, resolveSwipeDirection, shouldCommitPull,
  type SwipeDirection,
} from "../lib/capture-gesture";
import { recordGestureAttempt, type GestureOutcome } from "../lib/gesture-trace";
import { useDiagnosticsStore } from "../state/diagnostics-store";
import { activeProfile, useSettingsStore } from "../state/settings-store";
import { useTheme } from "../theme";
import { CaptureScreen } from "./capture-screen";
import { HomeShellProvider, type HomeShell } from "./home-shell";
import { MenuScreen } from "./menu-screen";

const SETTLE = { duration: 220 };
const dismissKeyboard = () => Keyboard.dismiss();

export const HomeScreen = () => {
  const profile = useSettingsStore((state) => activeProfile(state.snapshot));
  return <HomeWorkspace key={`${profile?.id}:${profile?.notes_root}`} />;
};

const HomeWorkspace = () => {
  const theme = useTheme();
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const [menuVisible, setMenuVisible] = useState(false);
  const menuProgress = useSharedValue(0);
  const windowW = useSharedValue(width);
  const direction = useSharedValue<SwipeDirection>("pending");
  const dragging = useSharedValue(false);
  const pull = useSharedValue(0);
  const pullReady = useSharedValue(false);
  const transitioning = useSharedValue(false);
  const commitRequest = useSharedValue(0);
  const commitVelocity = useSharedValue(0);
  const suppressPressUntil = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startProgress = useSharedValue(0);
  const startedOpen = useSharedValue(false);
  const startTime = useSharedValue(0);
  const maxDx = useSharedValue(0);
  const maxDy = useSharedValue(0);
  const maxPull = useSharedValue(0);
  const traceEmitted = useSharedValue(false);
  const outcome = useSharedValue<GestureOutcome>("idle");
  const trace = useDiagnosticsStore((state) => state.diagnostics.traceGestures);
  const traceEnabled = useSharedValue(trace);
  useEffect(() => { windowW.value = width; }, [width, windowW]);
  useEffect(() => { traceEnabled.value = trace; }, [trace, traceEnabled]);

  // These wrap RN scroll views, not RNGH's already-wrapped components.
  const captureScroll = useMemo(() => Gesture.Native(), []);
  const feedScroll = useMemo(() => Gesture.Native(), []);
  const folderScroll = useMemo(() => Gesture.Native(), []);

  const settled = useCallback((open: boolean) => setMenuVisible(open), []);
  const openMenu = useCallback(() => {
    if (transitioning.value) return;
    Keyboard.dismiss();
    menuProgress.value = withTiming(1, SETTLE, (finished) => {
      if (finished) runOnJS(settled)(true);
    });
  }, [menuProgress, settled, transitioning]);
  const openCapture = useCallback(() => {
    menuProgress.value = withTiming(0, SETTLE, (finished) => {
      if (finished) runOnJS(settled)(false);
    });
  }, [menuProgress, settled]);

  useEffect(() => {
    if (!focused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (menuProgress.value >= 0.5) return false;
      openMenu();
      return true;
    });
    return () => subscription.remove();
  }, [focused, menuProgress, openMenu]);

  const gesture = useMemo(() => Gesture.Pan()
    .enabled(focused)
    .manualActivation(true)
    .maxPointers(1)
    .cancelsTouchesInView(false)
    .simultaneousWithExternalGesture(captureScroll, feedScroll, folderScroll)
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch || event.allTouches.length !== 1) {
        manager.fail();
        return;
      }
      direction.value = "pending";
      dragging.value = false;
      pull.value = 0;
      pullReady.value = false;
      traceEmitted.value = false;
      startTime.value = Date.now();
      startX.value = touch.absoluteX;
      startY.value = touch.absoluteY;
      startProgress.value = menuProgress.value;
      startedOpen.value = menuProgress.value >= 0.5;
      maxDx.value = 0;
      maxDy.value = 0;
      maxPull.value = 0;
      outcome.value = transitioning.value ? "blocked" : "idle";
      if (transitioning.value) manager.fail();
    })
    .onTouchesMove((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch || event.allTouches.length !== 1) {
        manager.fail();
        return;
      }
      if (direction.value !== "pending") return;
      // A held touch belongs to text selection or a row's long-press menu.
      if (Date.now() - startTime.value > 350) {
        manager.fail();
        return;
      }
      const dx = touch.absoluteX - startX.value;
      const dy = touch.absoluteY - startY.value;
      maxDx.value = dx;
      maxDy.value = dy;
      direction.value = resolveSwipeDirection("pending", dx, dy);
      if (direction.value === "pending") return;
      if (direction.value === "diagonal") {
        outcome.value = "diagonal";
        suppressPressUntil.value = Date.now() + 250;
        manager.fail();
        return;
      }
      const horizontal = direction.value === "left" || direction.value === "right";
      if (horizontal && ((startProgress.value >= 0.999 && direction.value === "right") ||
          (startProgress.value <= 0.001 && direction.value === "left"))) {
        manager.fail();
        return;
      }
      if (horizontal) {
        cancelAnimation(menuProgress);
        runOnJS(dismissKeyboard)();
      }
      manager.activate();
    })
    .onStart(() => { dragging.value = true; })
    .onUpdate((event) => {
      if (Math.abs(event.translationX) > Math.abs(maxDx.value)) maxDx.value = event.translationX;
      if (Math.abs(event.translationY) > Math.abs(maxDy.value)) maxDy.value = event.translationY;
      maxPull.value = Math.max(maxPull.value, pull.value);
      suppressPressUntil.value = Date.now() + 250;
      if (direction.value === "left" || direction.value === "right") {
        menuProgress.value = Math.max(0, Math.min(1,
          startProgress.value + event.translationX / Math.max(1, windowW.value)));
      }
    })
    .onEnd((event, success) => {
      maxPull.value = Math.max(maxPull.value, pull.value);
      if (direction.value === "left" || direction.value === "right") {
        const target = menuReleaseTarget(menuProgress.value, event.velocityX, startedOpen.value, success);
        outcome.value = success ? (target ? "menu-open" : "menu-close") : "cancelled";
        menuProgress.value = withTiming(target, SETTLE, (finished) => {
          if (finished) runOnJS(settled)(target === 1);
        });
      } else if (!startedOpen.value && shouldCommitPull(
        direction.value, pullReady.value, success, transitioning.value
      )) {
        transitioning.value = true;
        commitVelocity.value = event.velocityY;
        commitRequest.value += 1;
        outcome.value = "filed";
      } else {
        outcome.value = !success ? "cancelled" : maxPull.value > 0 ? "released" : "scroll";
      }
    })
    .onFinalize(() => {
      if (traceEnabled.value && !traceEmitted.value) {
        traceEmitted.value = true;
        runOnJS(recordGestureAttempt)({
          at: Date.now(), startX: startX.value, startY: startY.value,
          maxDx: maxDx.value, maxDy: maxDy.value, maxPull: maxPull.value,
          durationMs: Date.now() - startTime.value,
          direction: direction.value, outcome: outcome.value,
        });
      }
      dragging.value = false;
      pullReady.value = false;
      if (!transitioning.value) pull.value = withTiming(0, { duration: 180 });
    }), [focused, captureScroll, feedScroll, folderScroll, direction, dragging, pull,
      pullReady, transitioning, commitRequest, commitVelocity, suppressPressUntil, startX, startY,
      startProgress, startedOpen, startTime, maxDx, maxDy, maxPull, outcome,
      traceEnabled, traceEmitted, menuProgress, windowW, settled]);

  const menuStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -windowW.value * 0.25 * (1 - menuProgress.value) }],
  }));
  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: windowW.value * menuProgress.value }],
  }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: 0.08 * (1 - menuProgress.value) }));
  const shell = useMemo<HomeShell>(() => ({
    menuVisible, menuProgress, direction, dragging, pull, pullReady, transitioning,
    commitRequest, commitVelocity, suppressPressUntil, captureScroll, feedScroll,
    folderScroll, openMenu, openCapture,
  }), [menuVisible, menuProgress, direction, dragging, pull, pullReady, transitioning,
    commitRequest, commitVelocity, suppressPressUntil, captureScroll, feedScroll,
    folderScroll, openMenu, openCapture]);

  return (
    <HomeShellProvider value={shell}>
      <GestureDetector gesture={gesture}>
        <View collapsable={false} style={[styles.root, { backgroundColor: theme.colors.background }]}>
          <Animated.View style={[StyleSheet.absoluteFill, menuStyle]}
            pointerEvents={menuVisible ? "auto" : "none"}
            accessibilityElementsHidden={!menuVisible}
            importantForAccessibility={menuVisible ? "auto" : "no-hide-descendants"}>
            <MenuScreen />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} />
          <Animated.View style={[styles.root, pageStyle]}
            pointerEvents={menuVisible ? "none" : "auto"}
            accessibilityElementsHidden={menuVisible}
            importantForAccessibility={menuVisible ? "no-hide-descendants" : "auto"}>
            <CaptureScreen />
          </Animated.View>
        </View>
      </GestureDetector>
    </HomeShellProvider>
  );
};

const styles = StyleSheet.create({ root: { flex: 1 }, dim: { backgroundColor: "#000" } });
