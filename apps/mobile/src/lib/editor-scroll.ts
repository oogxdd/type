import { requireOptionalNativeModule } from "expo-modules-core";
import { findNodeHandle, Platform, type TextInput } from "react-native";

const native = Platform.OS === "ios"
  ? requireOptionalNativeModule<{ revealSelection(tag: number): Promise<number | null> }>("EditorScroll")
  : null;

export const hasNativeEditorScroll = native !== null;

export const revealEditorSelection = async (input: TextInput | null): Promise<number | null> => {
  const tag = input && findNodeHandle(input);
  if (!native || tag == null) return null;
  return native.revealSelection(tag).catch(() => null);
};
