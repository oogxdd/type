import { requireOptionalNativeModule } from "expo-modules-core";
import { findNodeHandle, Platform, type TextInput } from "react-native";

const native = Platform.OS === "ios"
  ? requireOptionalNativeModule<{ revealSelection(tag: number): Promise<void> }>("EditorScroll")
  : null;

export const hasNativeEditorScroll = native !== null;

export const revealEditorSelection = (input: TextInput | null) => {
  const tag = input && findNodeHandle(input);
  if (native && tag != null) void native.revealSelection(tag).catch(() => {});
};
