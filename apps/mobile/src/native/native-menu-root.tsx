import { SafeAreaProvider } from "react-native-safe-area-context";

import { resetMainStackToScreen, type MainStackParamList } from "../navigation";
import { MenuContent } from "../screens/menu-screen";
import { closeNativeEdgeMenu } from "./native-edge-menu";

type OpenScreen = <Screen extends keyof MainStackParamList>(
  screen: Screen,
  params?: MainStackParamList[Screen]
) => void;

export const NativeMenuRoot = () => {
  const openScreen: OpenScreen = (screen, params) => {
    resetMainStackToScreen(screen, params);
    closeNativeEdgeMenu();
  };

  return (
    <SafeAreaProvider>
      <MenuContent onOpenScreen={openScreen} onClose={closeNativeEdgeMenu} />
    </SafeAreaProvider>
  );
};
