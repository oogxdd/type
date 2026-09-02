import {
  CommonActions,
  createNavigationContainerRef,
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from "@react-navigation/native-stack";
import { useEffect } from "react";

// One native stack, with Menu as its root. Conceptually Menu sits to the
// left of Capture and Sync sits to its right. The app boots with Capture
// pushed above Menu (see App.tsx), so the native interactive back gesture
// reveals Menu. The two forward gestures use live previews and then attach
// the real stack screen underneath with animation disabled.
export type RootStackParamList = {
  Menu: undefined;
  // `instant` skips the native push because a gesture-driven preview has
  // already played the transition (Menu -> Capture or Capture -> Sync).
  Capture: { instant?: boolean } | undefined;
  Feed: undefined;
  Folder: { path: string; title: string };
  Editor: { path: string; title?: string };
  Sync: { instant?: boolean } | undefined;
  Settings: undefined;
  SettingsWorkingFolders: undefined;
  SettingsTranscription: undefined;
  SettingsAppearance: undefined;
  SettingsDiagnostics: undefined;
};

export const Stack = createNativeStackNavigator<RootStackParamList>();

/** Container ref so deep-link handling can navigate from outside React. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export const navigateToScreen = <Screen extends keyof RootStackParamList>(
  screen: Screen,
  params?: RootStackParamList[Screen]
) => {
  if (navigationRef.isReady()) {
    navigationRef.dispatch(CommonActions.navigate({ name: screen, params }));
  }
};

/**
 * Screens reached through an already-animated preview are pushed with
 * `animation: "none"`. Clear that one-shot flag after the push settles so a
 * later native pop / back swipe animates normally.
 */
export const useClearInstantParam = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList, "Capture" | "Sync">>();
  const route = useRoute<RouteProp<RootStackParamList, "Capture" | "Sync">>();
  const instant = route.params?.instant;

  useEffect(() => {
    if (!instant) {
      return;
    }
    const clear = () => navigation.setParams({ instant: undefined });
    const unsubscribe = navigation.addListener("transitionEnd", (event) => {
      if (!event.data.closing) {
        clear();
      }
    });
    const fallback = setTimeout(clear, 600);
    return () => {
      unsubscribe();
      clearTimeout(fallback);
    };
  }, [navigation, instant]);
};
