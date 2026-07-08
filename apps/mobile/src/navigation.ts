import {
  CommonActions,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

// One native stack with the capture page as its root. The menu is PUSHED
// over it (sliding in from the side configured in ui-prefs), so the draft on
// the capture page stays alive underneath while the menu is open. Opening
// the menu is the hamburger or a custom edge-swipe strip on the capture
// page; closing it is native (swipe from the opposite edge, or the close
// button). Every other screen is pushed from the menu, so swipe-back walks
// Editor/Folder/Sync/Settings → Menu → Capture entirely natively.
export type RootStackParamList = {
  Capture: undefined;
  Menu: undefined;
  Feed: undefined;
  Folder: { path: string; title: string };
  Editor: { path: string; title?: string };
  Sync: undefined;
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
