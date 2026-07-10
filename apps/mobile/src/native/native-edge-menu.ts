import { NativeModules, Platform } from "react-native";

type NativeEdgeMenuModule = {
  openMenu?: () => void;
  closeMenu?: () => void;
};

const module = NativeModules.NativeEdgeMenu as NativeEdgeMenuModule | undefined;

export const nativeEdgeMenuAvailable = Platform.OS === "ios" && !!module;

export const openNativeEdgeMenu = () => {
  module?.openMenu?.();
};

export const closeNativeEdgeMenu = () => {
  module?.closeMenu?.();
};
