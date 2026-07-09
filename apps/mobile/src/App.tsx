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
import {
  jumpToHomePage,
  navigateToScreen,
  navigationRef,
  Stack,
} from "./navigation";
import { EditorScreen } from "./screens/editor-screen";
import { FeedScreen } from "./screens/feed-screen";
import { FolderScreen } from "./screens/folder-screen";
import { HomePagerScreen } from "./screens/home-pager";
import { LockScreen } from "./screens/lock-screen";
import {
  SettingsScreen,
  SettingsTranscriptionScreen,
  SettingsWorkingFoldersScreen,
} from "./screens/settings-screen";
import { useNotesStore } from "./state/notes-store";
import { isLocked, useSecurityStore } from "./state/security-store";
import { useSettingsStore } from "./state/settings-store";
import { useSyncStore } from "./state/sync-store";
import { useTheme } from "./theme";

type BootPhase = { state: "booting" } | { state: "ready" } | { state: "failed"; error: string };

const RootStack = () => {
  const theme = useTheme();
  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.background },
        // Swipe back from anywhere on the screen, not just the left edge —
        // still the native UIKit pop transition, driven natively by
        // react-native-screens' pan recognizer. It doesn't steal taps (a pan
        // needs clear horizontal movement before it claims the touch).
        fullScreenGestureEnabled: true,
        // Chevron-only back everywhere; screen titles say where you are, the
        // label naming the previous screen is noise.
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen
        name="Home"
        component={HomePagerScreen}
        options={{ headerShown: false }}
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
 * page, which applies it. Pops back to the Home pager first in case a screen
 * is pushed on top; on cold start the pager picks the parked jump up on
 * mount.
 */
const handleSyncUrl = (url: string | null) => {
  const params = url ? parseSyncDeepLink(url) : null;
  if (!params) {
    return;
  }
  useSyncStore.getState().setPendingLink(params);
  navigateToScreen("Home");
  jumpToHomePage("sync", false);
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
