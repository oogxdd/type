import { useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { mobileRuntime } from "../core/runtime";
import { useTheme } from "../theme";

/** Actionable save failures stay visible across navigation. No note text. */
export const RuntimeNotice = () => {
  const status = useSyncExternalStore(mobileRuntime.subscribe, mobileRuntime.getStatus);
  const theme = useTheme();
  if (!status.error && !status.operation) return null;
  return <View style={[styles.notice, { backgroundColor: theme.colors.surface }]} testID="runtime-notice">
    <Text style={{ color: status.error ? theme.colors.danger : theme.colors.text }}>{status.error ?? status.operation}</Text>
    {status.error ? <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={mobileRuntime.requestSave}><Text style={{ color: theme.colors.accent }}>Retry save</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => { void mobileRuntime.saveCopy().catch(mobileRuntime.saveError); }}><Text style={{ color: theme.colors.accent }}>Save a copy</Text></Pressable>
    </View> : null}
  </View>;
};
const styles = StyleSheet.create({ notice: { position: "absolute", top: 60, left: 12, right: 12, padding: 12, borderRadius: 12, gap: 8 }, actions: { flexDirection: "row", gap: 24 } });
