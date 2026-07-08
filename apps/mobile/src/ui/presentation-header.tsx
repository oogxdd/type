import { useNavigation } from "@react-navigation/native";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../theme";
import { ToolbarButton } from "./toolbar-button";

export const PresentationHeader = ({ title }: { title: string }) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  return (
    <View
      style={[
        styles.header,
        {
          borderBottomColor: theme.colors.border,
          paddingTop: insets.top + 8,
        },
      ]}
    >
      <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
      <ToolbarButton icon="close-outline" onPress={() => navigation.goBack()} />
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
  },
});
