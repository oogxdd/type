import { createDrawerNavigator } from "@react-navigation/drawer";
import {
  createNavigationContainerRef,
  type NavigatorScreenParams,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

export type RootStackParamList = {
  Capture: undefined;
  Feed: undefined;
  Folder: { path: string; title: string };
  Editor: { path: string; title?: string };
  Record: undefined;
  Sync: undefined;
  Settings: undefined;
  SettingsWorkingFolders: undefined;
  SettingsTranscription: undefined;
};

// The drawer wraps the whole stack: its content is the app menu (Feed/Folders
// tabs + Sync/Settings), opened with the hamburger or an edge swipe.
export type DrawerParamList = {
  Home: NavigatorScreenParams<RootStackParamList> | undefined;
};

export const Stack = createNativeStackNavigator<RootStackParamList>();
export const Drawer = createDrawerNavigator<DrawerParamList>();

/** Container ref so deep-link handling can navigate from outside React. */
export const navigationRef = createNavigationContainerRef<DrawerParamList>();

export const navigateToScreen = <Screen extends keyof RootStackParamList>(
  screen: Screen,
  params?: RootStackParamList[Screen]
) => {
  if (navigationRef.isReady()) {
    navigationRef.navigate("Home", { screen, params } as never);
  }
};
