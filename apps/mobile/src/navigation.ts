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

// One native stack rooted at Home, which is the capture page and the menu
// together -- two layers of one screen rather than two screens (see
// home-screen.tsx for why). Everything else is pushed on top of it and keeps
// the ordinary native back gesture, which is free there because those screens
// have no gestures of their own.
//
// Sync still sits to Capture's right and is reached through a live preview
// that attaches the real screen underneath with animation disabled.
export type RootStackParamList = {
  Home: undefined;
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
    useNavigation<NativeStackNavigationProp<RootStackParamList, "Sync">>();
  const route = useRoute<RouteProp<RootStackParamList, "Sync">>();
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
