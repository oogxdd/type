import {
  CommonActions,
  createNavigationContainerRef,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
} from "@react-navigation/native-stack";

// Home owns the persistent menu/capture layers and their shared gesture.
// Detail screens use the native stack above it.
export type RootStackParamList = {
  Home: undefined;
  Feed: undefined;
  Folder: { path: string; title: string };
  Editor: { path: string; title?: string };
  Sync: undefined;
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
