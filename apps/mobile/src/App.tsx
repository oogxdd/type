import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
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
  SettingsScreen,
  SettingsTranscriptionScreen,
  SettingsWorkingFoldersScreen,
} from "./screens/settings-screen";
import { SyncScreen } from "./screens/sync-screen";
import { useNotesStore } from "./state/notes-store";
import { isLocked, useSecurityStore } from "./state/security-store";
import { useSettingsStore } from "./state/settings-store";
import { useSyncStore } from "./state/sync-store";
import { useTheme } from "./theme";

type BootPhase = { state: "booting" } | { state: "ready" } | { state: "failed"; error: string };

// Boot with Capture pushed on top of Menu so the blank page is what you see
// first, while the menu is already "behind" it — the native left-edge
// swipe-back on Capture slides the menu in. See navigation.ts for the model.
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
        // screens with their own gestures (capture, menu) only claim
        // clearly-vertical or leftward drags.
        fullScreenGestureEnabled: true,
        // Chevron-only back everywhere: with several entry points per screen
        // (Sync can be reached from the menu or a capture swipe) the label
        // would name whatever screen you came from — noise.
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
          // `instant` = the menu's swipe-to-capture already played the push
          // transition with its preview overlay (menu-screen.tsx), so the
          // real screen must appear under it without animating again. The
          // screen clears the param once the push settles so the later
          // pop/back-swipe animates natively.
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
          // `instant` = the capture page's leftward swipe already played the
          // push transition with its preview (capture-screen.tsx); same
          // mechanism as the menu → capture push above.
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
  const demoMode = useSettingsStore((s) => s.demoMode);
  const initialUrlHandled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
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
          theme={theme.dark ? DarkTheme : DefaultTheme}
          initialState={BOOT_NAVIGATION_STATE}
          onReady={() => {
            if (!initialUrlHandled.current) {
              initialUrlHandled.current = true;
              void Linking.getInitialURL().then(handleSyncUrl);
            }
          }}
        >
          <RootStack />
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
