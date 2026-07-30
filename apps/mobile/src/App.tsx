import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { getErrorMessage } from "@typenotes/shared/errors";
import { parseSyncDeepLink } from "@typenotes/shared/sync-link";

import { bootCore } from "./core/boot";
import { navigateToScreen, navigationRef, Stack } from "./navigation";
import { CaptureScreen } from "./screens/capture-screen";
import { EditorScreen } from "./screens/editor-screen";
import { FeedScreen } from "./screens/feed-screen";
import { FolderScreen } from "./screens/folder-screen";
import { LockScreen } from "./screens/lock-screen";
import { MenuScreen } from "./screens/menu-screen";
import {
  SettingsAppearanceScreen,
  SettingsScreen,
  SettingsTranscriptionScreen,
  SettingsWorkingFoldersScreen,
} from "./screens/settings-screen";
import { SyncScreen } from "./screens/sync-screen";
import { useAppearanceStore } from "./state/appearance-store";
import { useNotesStore } from "./state/notes-store";
import { isLocked, useSecurityStore } from "./state/security-store";
import { useSettingsStore } from "./state/settings-store";
import { useSyncStore } from "./state/sync-store";
import { useTheme } from "./theme";
import { ErrorBoundary } from "./ui/error-boundary";

type BootPhase = { state: "booting" } | { state: "ready" } | { state: "failed"; error: string };

// Boot with Capture pushed on top of Menu so the blank page is what you see
// first, while the menu is already behind it. Capture can then use the native
// interactive back gesture to reveal Menu without keeping all three primary
// screens mounted in a pager.
const BOOT_NAVIGATION_STATE = {
  routes: [{ name: "Menu" as const }, { name: "Capture" as const }],
};

const RootStack = () => {
  const theme = useTheme();
  return (
    <Stack.Navigator
      initialRouteName="Capture"
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.background },
        // Swipe back from anywhere on the screen, not just the left edge —
        // still the native UIKit pop transition, driven natively by
        // react-native-screens' pan recognizer. It doesn't steal taps (a pan
        // needs clear horizontal movement before it claims the touch), and
        // the capture/menu gestures fail quickly for the other axis.
        fullScreenGestureEnabled: true,
        // Chevron-only back everywhere: Sync has more than one entry point,
        // so naming the previous screen in the label would be noise.
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen
        name="Menu"
        component={MenuScreen}
        options={{ gestureEnabled: false, headerShown: false, title: "Menu" }}
      />
      <Stack.Screen
        name="Capture"
        component={CaptureScreen}
        options={({ route }) => ({
          headerShown: false,
          // A gesture-driven preview already played this push when instant
          // is set; attach the real screen underneath without replaying it.
          animation: route.params?.instant ? "none" : "default",
        })}
      />
      <Stack.Screen name="Feed" component={FeedScreen} />
      <Stack.Screen
        name="Folder"
        component={FolderScreen}
        options={({ route }) => ({ title: route.params.title })}
      />
      <Stack.Screen
        name="Editor"
        component={EditorScreen}
        options={{
          // No title — the note text speaks for itself.
          title: "",
        }}
      />
      <Stack.Screen
        name="Sync"
        component={SyncScreen}
        options={({ route }) => ({
          title: "Sync",
          // Same preview-to-real-screen handoff as Menu -> Capture.
          animation: route.params?.instant ? "none" : "default",
        })}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: "Settings" }}
      />
      <Stack.Screen
        name="SettingsWorkingFolders"
        component={SettingsWorkingFoldersScreen}
        options={{ title: "Working Folders" }}
      />
      <Stack.Screen
        name="SettingsTranscription"
        component={SettingsTranscriptionScreen}
        options={{ title: "Transcription" }}
      />
      <Stack.Screen
        name="SettingsAppearance"
        component={SettingsAppearanceScreen}
        options={{ title: "Appearance" }}
      />
    </Stack.Navigator>
  );
};

/**
 * A `type2://sync?...` link (from the desktop's QR code, scanned with the
 * system camera) drops the remote into the sync store and jumps to the Sync
 * screen, which applies it.
 */
const handleSyncUrl = (url: string | null) => {
  const params = url ? parseSyncDeepLink(url) : null;
  if (!params) {
    return;
  }
  useSyncStore.getState().setPendingLink(params);
  navigateToScreen("Sync");
};

export default function App() {
  const theme = useTheme();
  const [phase, setPhase] = useState<BootPhase>({ state: "booting" });
  // The stock light/dark navigation themes carry their own background, which
  // would flash behind screens during transitions once the user picks a
  // custom one. Feed ours through instead.
  const navigationTheme = useMemo(() => {
    const base = theme.dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: theme.dark,
      colors: {
        ...base.colors,
        primary: theme.colors.accent,
        background: theme.colors.background,
        card: theme.colors.background,
        text: theme.colors.text,
        border: theme.colors.border,
      },
    };
  }, [theme]);
  const demoMode = useSettingsStore((s) => s.demoMode);
  const initialUrlHandled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // First, so the boot/lock screens already paint in the user's chosen
        // colors instead of flashing the system palette. It reads a plain
        // file, so it does not depend on the core coming up.
        await useAppearanceStore.getState().load();
        const { demoMode: demo } = await bootCore();
        useSettingsStore.getState().setDemoMode(demo);
        await useSecurityStore.getState().load();
        // While encrypted + locked, content calls are rejected by the core —
        // the lock screen's unlock reloads these stores instead.
        if (!isLocked(useSecurityStore.getState().state)) {
          await useSettingsStore.getState().load();
          await useNotesStore.getState().refresh();
          // Best-effort — populates the menu's "last synced" label without
          // forcing the user through the Sync screen first.
          void useSyncStore.getState().refresh().catch(() => {});
        }
        if (!cancelled) {
          setPhase({ state: "ready" });
        }
      } catch (error) {
        if (!cancelled) {
          setPhase({ state: "failed", error: getErrorMessage(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Deep links while the app is running; the initial (cold-start) URL is
  // picked up in the container's onReady below.
  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) =>
      handleSyncUrl(url)
    );
    return () => subscription.remove();
  }, []);

  // Auto-lock when the app goes to background (if enabled in security prefs).
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      const security = useSecurityStore.getState();
      if (
        next === "background" &&
        security.state?.encryption_enabled &&
        security.state.auto_lock_on_background
      ) {
        void security.lock();
      }
    });
    return () => subscription.remove();
  }, []);

  const securityState = useSecurityStore((s) => s.state);
  const locked = isLocked(securityState);

  if (phase.state !== "ready") {
    return (
      <View style={[styles.boot, { backgroundColor: theme.colors.background }]}>
        {phase.state === "failed" ? (
          <Text style={[styles.bootError, { color: theme.colors.danger }]}>
            {phase.error}
          </Text>
        ) : null}
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </View>
    );
  }

  if (locked) {
    return (
      <SafeAreaProvider>
        <LockScreen />
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </SafeAreaProvider>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <NavigationContainer
          ref={navigationRef}
          theme={navigationTheme}
          initialState={BOOT_NAVIGATION_STATE}
          onReady={() => {
            if (!initialUrlHandled.current) {
              initialUrlHandled.current = true;
              void Linking.getInitialURL().then(handleSyncUrl);
            }
          }}
        >
          <ErrorBoundary>
            <RootStack />
          </ErrorBoundary>
        </NavigationContainer>
        {demoMode ? (
          <View style={[styles.demoBanner, { backgroundColor: theme.colors.accent }]}>
            <Text style={styles.demoBannerText}>
              Demo mode — native core not linked, notes are not persisted
            </Text>
          </View>
        ) : null}
        <StatusBar style={theme.dark ? "light" : "dark"} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  boot: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  bootError: { fontSize: 15, textAlign: "center" },
  demoBanner: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 4,
    alignItems: "center",
  },
  demoBannerText: { color: "#ffffff", fontSize: 12, fontWeight: "600" },
});
