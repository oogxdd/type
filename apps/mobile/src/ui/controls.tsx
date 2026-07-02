// Tiny shared primitives for the utility screens (sync, settings, record).
// The capture page deliberately uses none of these — it is just a text field.

import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { useTheme } from "../theme";

export const Section = ({ title, children }: { title: string; children: ReactNode }) => {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.colors.secondaryText }]}>
        {title.toUpperCase()}
      </Text>
      <View
        style={[
          styles.sectionBody,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}
      >
        {children}
      </View>
    </View>
  );
};

export const Field = (
  props: TextInputProps & { label: string }
) => {
  const theme = useTheme();
  const { label, style, ...inputProps } = props;
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.colors.secondaryText }]}>
        {label}
      </Text>
      <TextInput
        placeholderTextColor={theme.colors.secondaryText}
        autoCapitalize="none"
        autoCorrect={false}
        {...inputProps}
        style={[
          styles.fieldInput,
          {
            color: theme.colors.text,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.background,
          },
          style,
        ]}
      />
    </View>
  );
};

export const Button = ({
  title,
  onPress,
  kind = "primary",
  disabled,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) => {
  const theme = useTheme();
  const background =
    kind === "primary"
      ? theme.colors.accent
      : kind === "danger"
        ? theme.colors.danger
        : theme.colors.surface;
  const color = kind === "secondary" ? theme.colors.text : "#ffffff";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          borderColor: theme.colors.border,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[styles.buttonText, { color }]}>{title}</Text>
    </Pressable>
  );
};

export const InlineNote = ({ children }: { children: ReactNode }) => {
  const theme = useTheme();
  return (
    <Text style={[styles.inlineNote, { color: theme.colors.secondaryText }]}>
      {children}
    </Text>
  );
};

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginBottom: 6,
    marginLeft: 4,
  },
  sectionBody: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
  },
  field: { gap: 4 },
  fieldLabel: { fontSize: 12, fontWeight: "500" },
  fieldInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  button: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonText: { fontSize: 15, fontWeight: "600" },
  inlineNote: { fontSize: 12, lineHeight: 17 },
});
