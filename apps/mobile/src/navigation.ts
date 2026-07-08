import {
  CommonActions,
  createNavigationContainerRef,
  type NavigatorScreenParams,
} from "@react-navigation/native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

// The app root is a full-width drawer whose only real screen is the native
// stack below. The drawer gives the capture page an interactive edge-swipe
// menu without turning the menu itself into a stack route.
export type MainStackParamList = {
  Capture: undefined;
  Feed: undefined;
  Folder: { path: string; title: string };
  Editor: { path: string; title?: string };
  Sync: undefined;
  Settings: undefined;
  SettingsWorkingFolders: undefined;
  SettingsTranscription: undefined;
};

export type RootDrawerParamList = {
  Main: NavigatorScreenParams<MainStackParamList> | undefined;
};

export const Drawer = createDrawerNavigator<RootDrawerParamList>();
export const Stack = createNativeStackNavigator<MainStackParamList>();

/** Container ref so deep-link handling can navigate from outside React. */
export const navigationRef = createNavigationContainerRef<RootDrawerParamList>();

export const navigateToScreen = <Screen extends keyof MainStackParamList>(
  screen: Screen,
  params?: MainStackParamList[Screen]
) => {
  if (navigationRef.isReady()) {
    navigationRef.dispatch(
      CommonActions.navigate({ name: "Main", params: { screen, params } })
    );
  }
};
