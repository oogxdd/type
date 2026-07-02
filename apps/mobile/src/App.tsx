import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { getErrorMessage } from "@typenotes/shared/errors";

import { bootCore } from "./core/boot";
import { Stack } from "./navigation";
import { CaptureScreen } from "./screens/capture-screen";
import { EditorScreen } from "./screens/editor-screen";
import { FeedScreen } from "./screens/feed-screen";
import { FolderScreen } from "./screens/folder-screen";
import { LockScreen } from "./screens/lock-screen";
import { RecordScreen } from "./screens/record-screen";
import { SettingsScreen } from "./screens/settings-screen";
import { SyncScreen } from "./screens/sync-screen";
import { useNotesStore } from "./state/notes-store";
import { isLocked, useSecurityStore } from "./state/security-store";
import { useSettingsStore } from "./state/settings-store";
import { useTheme } from "./theme";

type BootPhase = { state: "booting" } | { state: "ready" } | { state: "failed"; error: string };

export default function App() {
  const theme = useTheme();
  const [phase, setPhase] = useState<BootPhase>({ state: "booting" });
  const demoMode = useSettingsStore((s) => s.demoMode);

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
        <NavigationContainer theme={theme.dark ? DarkTheme : DefaultTheme}>
          <Stack.Navigator
            initialRouteName="Capture"
            screenOptions={{
              headerStyle: { backgroundColor: theme.colors.background },
              headerTintColor: theme.colors.text,
              headerShadowVisible: false,
              contentStyle: { backgroundColor: theme.colors.background },
            }}
          >
            <Stack.Screen
              name="Capture"
              component={CaptureScreen}
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
              options={({ route }) => ({ title: route.params.title ?? "Note" })}
            />
            <Stack.Screen name="Record" component={RecordScreen} />
            <Stack.Screen name="Sync" component={SyncScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
          </Stack.Navigator>
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
