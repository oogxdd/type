// iOS-style inset-grouped list primitives for the settings screens: a
// surface card per group with hairline separators, 44pt rows with optional
// colored icon tiles, right-aligned values, chevrons/checkmarks, blue action
// rows, and field rows. Header/footer text sits outside the card like the
// system Settings app.

import { Ionicons } from "@expo/vector-icons";
import { Children, Fragment, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { useTheme } from "../theme";

export const SettingsGroup = ({
  header,
  footer,
  separatorInset = 16,
  children,
}: {
  header?: string;
  footer?: ReactNode;
  /** Left inset of row separators; 57 aligns with text next to an icon tile. */
  separatorInset?: number;
  children: ReactNode;
}) => {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      {header ? (
        <Text style={[styles.groupHeader, { color: theme.colors.secondaryText }]}>
          {header.toUpperCase()}
        </Text>
      ) : null}
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        {rows.map((row, index) => (
          <Fragment key={index}>
            {row}
            {index < rows.length - 1 ? (
              <View
                style={[
                  styles.separator,
                  { marginLeft: separatorInset, backgroundColor: theme.colors.border },
                ]}
              />
            ) : null}
          </Fragment>
        ))}
      </View>
      {footer ? (
        <Text style={[styles.groupFooter, { color: theme.colors.secondaryText }]}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
};

export const SettingsRow = ({
  icon,
  iconColor,
  title,
  subtitle,
  value,
  checked,
  chevron,
  disabled,
  onPress,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  /** Background of the iOS-style rounded icon tile (glyph is white). */
  iconColor?: string;
  title: string;
  subtitle?: string;
  value?: string;
  checked?: boolean;
  chevron?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) => {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.dark ? "#ffffff14" : "#00000010" },
      ]}
    >
      {icon ? (
        <View style={[styles.iconTile, { backgroundColor: iconColor ?? theme.colors.accent }]}>
          <Ionicons name={icon} size={17} color="#ffffff" />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: theme.colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[styles.rowSubtitle, { color: theme.colors.secondaryText }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          style={[styles.rowValue, { color: theme.colors.secondaryText }]}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {checked ? (
        <Ionicons name="checkmark" size={19} color={theme.colors.accent} />
      ) : null}
      {chevron ? (
        <Ionicons
          name="chevron-forward"
          size={16}
          color={theme.colors.secondaryText}
          style={styles.chevron}
        />
      ) : null}
    </Pressable>
  );
};

/** A tappable row of accent text — the grouped-list equivalent of a button. */
export const SettingsActionRow = ({
  title,
  disabled,
  onPress,
}: {
  title: string;
  disabled?: boolean;
  onPress: () => void;
}) => {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.dark ? "#ffffff14" : "#00000010" },
      ]}
    >
      <Text
        style={[
          styles.rowTitle,
          { color: theme.colors.accent, opacity: disabled ? 0.4 : 1 },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
};

/** A text input living directly in a row, like iOS Settings' inline fields. */
export const SettingsFieldRow = (props: TextInputProps) => {
  const theme = useTheme();
  const { style, ...inputProps } = props;
  return (
    <View style={styles.row}>
      <TextInput
        placeholderTextColor={theme.colors.secondaryText}
        autoCapitalize="none"
        autoCorrect={false}
        {...inputProps}
        style={[styles.fieldInput, { color: theme.colors.text }, style]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  group: { marginBottom: 28 },
  groupHeader: {
    fontSize: 13,
    marginBottom: 7,
    marginHorizontal: 16,
  },
  groupFooter: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 7,
    marginHorizontal: 16,
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
  },
  separator: { height: StyleSheet.hairlineWidth },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  iconTile: {
    width: 29,
    height: 29,
    borderRadius: 6.5,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 16 },
  rowSubtitle: { fontSize: 13 },
  rowValue: { fontSize: 16, flexShrink: 1 },
  chevron: { marginLeft: -6, opacity: 0.6 },
  fieldInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
});
