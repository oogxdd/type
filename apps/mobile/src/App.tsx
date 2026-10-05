import { finishNavigationTrace } from "./lib/responsiveness-trace";
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { getErrorMessage } from "@typenotes/shared/errors";
import { parseSyncDeepLink } from "@typenotes/shared/sync-link";

import { bootMobile, startMobileLifecycle } from "./state/mobile-lifecycle";
import { RuntimeNotice } from "./ui/runtime-notice";
import { navigateToScreen, navigationRef, Stack } from "./navigation";
import { HomeScreen } from "./screens/home-screen";
import { FeedScreen } from "./screens/feed-screen";
import { FolderScreen } from "./screens/folder-screen";
import { LockScreen } from "./screens/lock-screen";
import {
  SettingsAppearanceScreen,
  SettingsDiagnosticsScreen,
  SettingsScreen,
  SettingsTranscriptionScreen,
  SettingsWorkingFoldersScreen,
} from "./screens/settings-screen";
import { SyncScreen } from "./screens/sync-screen";
import { isLocked, useSecurityStore } from "./state/security-store";
import { useSettingsStore } from "./state/settings-store";
import { useSyncStore } from "./state/sync-store";
import { useTheme } from "./theme";
import { ErrorBoundary } from "./ui/error-boundary";

type BootPhase = { state: "booting" } | { state: "ready" } | { state: "failed"; error: string };

const BUNDLED_FONTS = {
  TypeUnbounded: require("../assets/fonts/Unbounded.ttf"),
  TypeCormorantGaramond: require("../assets/fonts/CormorantGaramond.ttf"),
  TypeNeucha: require("../assets/fonts/Neucha.ttf"),
  TypeGolosText: require("../assets/fonts/GolosText.ttf"),
};

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
        // Pushed detail screens retain native back navigation.
        fullScreenGestureEnabled: true,
        // Chevron-only back everywhere: Sync has more than one entry point,
        // so naming the previous screen in the label would be noise.
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ gestureEnabled: false, fullScreenGestureEnabled: false, headerShown: false }}
      />
      <Stack.Screen name="Feed" component={FeedScreen} />
      <Stack.Screen
        name="Folder"
        component={FolderScreen}
        options={({ route }) => ({ title: route.params.title })}
      />
      <Stack.Screen
        name="Sync"
        component={SyncScreen}
        options={{ title: "Sync" }}
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
        name="SettingsDiagnostics"
        component={SettingsDiagnosticsScreen}
        options={{ title: "Diagnostics" }}
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
  const [fontsLoaded, fontError] = useFonts(BUNDLED_FONTS);
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
    const stopLifecycle = startMobileLifecycle();
    let cancelled = false;
    (async () => {
      try {
        await bootMobile();
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
      stopLifecycle();
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

  const securityState = useSecurityStore((s) => s.state);
  const locked = isLocked(securityState);

  if (phase.state !== "ready" || !fontsLoaded || fontError) {
    return (
      <View
        style={[styles.boot, { backgroundColor: theme.colors.background }]}
      >
        {phase.state === "failed" || fontError ? (
          <Text
            style={[styles.bootError, { color: theme.colors.danger }]}
          >
            {fontError?.message ?? (phase.state === "failed" ? phase.error : "")}
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
          onStateChange={finishNavigationTrace}
          theme={navigationTheme}
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
        <RuntimeNotice />
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
