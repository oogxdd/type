import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import ColorPicker, {
  HueCircular,
  Panel1,
  Preview,
  type ColorFormatsObject,
} from "reanimated-color-picker";

import { useTheme } from "../theme";

export const ColorWheelModal = ({
  visible,
  title,
  value,
  onClose,
  onSave,
}: {
  visible: boolean;
  title: string;
  value: string;
  onClose: () => void;
  onSave: (color: string) => void;
}) => {
  const theme = useTheme();
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (visible) {
      setDraft(value);
    }
  }, [value, visible]);

  const handleComplete = ({ hex }: ColorFormatsObject) => {
    setDraft(hex.slice(0, 7).toLowerCase());
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.flex}>
        <SafeAreaView
          edges={["top", "bottom"]}
          style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
        >
          <View
            style={[styles.header, { borderBottomColor: theme.colors.border }]}
          >
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text
                style={[styles.headerAction, { color: theme.colors.accent }]}
              >
                Cancel
              </Text>
            </Pressable>
            <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
            <Pressable
              onPress={() => {
                onSave(draft);
                onClose();
              }}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text
                style={[
                  styles.headerAction,
                  styles.done,
                  { color: theme.colors.accent },
                ]}
              >
                Done
              </Text>
            </Pressable>
          </View>

          <View style={styles.content}>
            <ColorPicker
              key={`${visible}-${value}`}
              value={draft}
              onCompleteJS={handleComplete}
              sliderThickness={24}
              thumbSize={28}
              boundedThumb
              style={styles.picker}
            >
              <HueCircular containerStyle={styles.wheel} thumbShape="pill">
                <Panel1 style={styles.panel} />
              </HueCircular>
              <Preview style={styles.preview} />
            </ColorPicker>
            <Text
              selectable
              style={[
                styles.hex,
                { color: theme.colors.text, borderColor: theme.colors.border },
              ]}
            >
              {draft}
            </Text>
            <Text
              style={[styles.hint, { color: theme.colors.secondaryText }]}
            >
              Drag around the ring for hue, then inside for saturation and
              brightness.
            </Text>
          </View>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    height: 52,
    paddingHorizontal: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerAction: { fontSize: 16, minWidth: 54 },
  done: { fontWeight: "600", textAlign: "right" },
  title: { fontSize: 17, fontWeight: "600" },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  picker: { width: "100%", maxWidth: 360, gap: 28 },
  wheel: { width: "100%", aspectRatio: 1, justifyContent: "center" },
  panel: {
    width: "68%",
    height: "68%",
    borderRadius: 18,
    alignSelf: "center",
  },
  preview: { height: 42, borderRadius: 12 },
  hex: {
    minWidth: 112,
    marginTop: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontFamily: "monospace",
    fontSize: 15,
    textAlign: "center",
  },
  hint: {
    maxWidth: 320,
    marginTop: 14,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
});
