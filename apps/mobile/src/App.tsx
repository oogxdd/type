import { Ionicons } from "@expo/vector-icons";
import {
  DarkTheme,
  DefaultTheme,
  DrawerActions,
  NavigationContainer,
} from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { getErrorMessage } from "@typenotes/shared/errors";
import { parseSyncDeepLink } from "@typenotes/shared/sync-link";

import { bootCore } from "./core/boot";
import { Drawer, navigateToScreen, navigationRef, Stack } from "./navigation";
import { CaptureScreen } from "./screens/capture-screen";
import { EditorScreen } from "./screens/editor-screen";
import { FeedScreen } from "./screens/feed-screen";
import { FolderScreen } from "./screens/folder-screen";
import { LockScreen } from "./screens/lock-screen";
import { RecordScreen } from "./screens/record-screen";
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
import { AppDrawerContent } from "./ui/drawer-content";

type BootPhase = { state: "booting" } | { state: "ready" } | { state: "failed"; error: string };

// Settings/Sync are dead-end destinations reached only from the drawer (no
// real stack parent to pop back to), so their back button reopens the
// drawer instead of popping to Capture, and the native swipe-back gesture is
// disabled so an edge swipe there always reopens the drawer too — see the
// nav feedback in the "swipe from left edge" gotcha this fixes.
const MenuBackButton = ({ onPress }: { onPress: () => void }) => {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.menuButton, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name="chevron-back" size={22} color={theme.colors.accent} />
      <Text style={[styles.menuButtonText, { color: theme.colors.accent }]}>Menu</Text>
    </Pressable>
  );
};

const HomeStack = () => {
  const theme = useTheme();
  return (
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
      <Stack.Screen
        name="Sync"
        component={SyncScreen}
        options={({ navigation }) => ({
          gestureEnabled: false,
          headerLeft: () => (
            <MenuBackButton onPress={() => navigation.dispatch(DrawerActions.openDrawer())} />
          ),
        })}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={({ navigation }) => ({
          gestureEnabled: false,
          headerLeft: () => (
            <MenuBackButton onPress={() => navigation.dispatch(DrawerActions.openDrawer())} />
          ),
        })}
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
          // Best-effort — populates the drawer's "last synced" label without
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
          <Drawer.Navigator
            drawerContent={(props) => <AppDrawerContent {...props} />}
            screenOptions={{
              headerShown: false,
              drawerType: "front",
              swipeEdgeWidth: 80,
              drawerStyle: { width: "100%" },
            }}
          >
            <Drawer.Screen name="Home" component={HomeStack} />
          </Drawer.Navigator>
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
  menuButton: { flexDirection: "row", alignItems: "center", paddingRight: 8 },
  menuButtonText: { fontSize: 17, marginLeft: -2 },
});
