import { createNativeStackNavigator } from "@react-navigation/native-stack";

export type RootStackParamList = {
  Capture: undefined;
  Feed: undefined;
  Folder: { path: string; title: string };
  Editor: { path: string; title?: string };
  Record: undefined;
  Sync: undefined;
  Settings: undefined;
};

export const Stack = createNativeStackNavigator<RootStackParamList>();
