import {
  CommonActions,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

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
  // `instant` skips the push animation: the menu's swipe-to-capture gesture
  // has already animated a preview of the page in, so the real screen must
  // appear underneath it without animating a second time.
  Capture: { instant?: boolean } | undefined;
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
