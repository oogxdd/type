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

// One native stack, with the menu as its root — conceptually the menu sits to
// the LEFT of the capture page and the sync screen to its RIGHT. The app
// boots with Capture pushed on top of Menu (see initialState in App.tsx), so
// the native swipe-back on the capture page reveals the menu; a leftward
// swipe on the menu drags a capture preview back in, and a leftward swipe on
// the capture page pushes Sync (swipe-back there lands on capture again).
// Every other screen is pushed from the menu so swipe-back walks naturally
// back to it.
export type RootStackParamList = {
  Menu: undefined;
  // `instant` skips the push animation: a gesture-driven preview has already
  // animated the page in (menu → capture, capture → sync), so the real
  // screen must appear underneath it without animating a second time.
  Capture: { instant?: boolean } | undefined;
  Feed: undefined;
  Folder: { path: string; title: string };
  Editor: { path: string; title?: string };
  Sync: { instant?: boolean } | undefined;
  Settings: undefined;
  SettingsWorkingFolders: undefined;
  SettingsTranscription: undefined;
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
 * For screens that can be pushed with `instant: true` (their transition was
 * already played by a gesture-driven preview, so the real push used
 * animation:"none"): flips the flag back once the push settles, so the later
 * pop / back swipe animates natively. Clearing on mount would be too early —
 * options would re-evaluate to the default animation before the native push
 * runs, visibly replaying it. The timeout is a fallback in case
 * animation:none emits no transition events.
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
