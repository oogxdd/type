// iOS-style inset-grouped list primitives for the settings screens: a
// surface card per group with hairline separators, 44pt rows with optional
// colored icon tiles, right-aligned values, chevrons/checkmarks, blue action
// rows, field rows, color-swatch grids, and −/+ stepper rows. Header/footer
// text sits outside the card like the system Settings app.

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
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
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

/**
 * A wrapping grid of labelled color swatches inside a row. Selection is a ring
 * rather than a checkmark, so it stays visible on a swatch of any color
 * (including one that matches the current background).
 */
export function SettingsSwatchRow<Id extends string>({
  options,
  selected,
  onSelect,
}: {
  /**
   * `color` is the concrete color to paint — "System" entries must already be
   * resolved by the caller so the grid previews what you will actually get.
   * `letter` renders a sample glyph in `color` over `fill` instead of a solid
   * disc, which is how text colors are previewed against the live background.
   */
  options: { id: Id; label: string; color: string; fill?: string }[];
  selected: Id;
  onSelect: (id: Id) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.swatchRow}>
      {options.map((option) => (
        <Pressable
          key={option.id}
          onPress={() => onSelect(option.id)}
          accessibilityRole="button"
          accessibilityLabel={option.label}
          accessibilityState={{ selected: option.id === selected }}
          style={styles.swatch}
        >
          <View
            style={[
              styles.swatchRing,
              {
                borderColor:
                  option.id === selected ? theme.colors.accent : "transparent",
              },
            ]}
          >
            <View
              style={[
                styles.swatchDisc,
                {
                  backgroundColor: option.fill ?? option.color,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              {option.fill ? (
                <Text style={[styles.swatchGlyph, { color: option.color }]}>Aa</Text>
              ) : null}
            </View>
          </View>
          <Text
            style={[styles.swatchLabel, { color: theme.colors.secondaryText }]}
            numberOfLines={1}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A row whose value is nudged by −/+ buttons, like iOS' text-size controls. */
export const SettingsStepperRow = ({
  title,
  value,
  onDecrease,
  onIncrease,
  canDecrease = true,
  canIncrease = true,
}: {
  title: string;
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  canDecrease?: boolean;
  canIncrease?: boolean;
}) => {
  const theme = useTheme();
  const step = (
    icon: "remove" | "add",
    onPress: () => void,
    enabled: boolean,
    accessibilityLabel: string
  ) => (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !enabled }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.stepperButton,
        {
          backgroundColor: theme.dark ? "#ffffff1a" : "#00000010",
          opacity: enabled ? (pressed ? 0.5 : 1) : 0.3,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={theme.colors.text} />
    </Pressable>
  );

  return (
    <View style={styles.row}>
      <Text style={[styles.rowTitle, styles.rowText, { color: theme.colors.text }]}>
        {title}
      </Text>
      {step("remove", onDecrease, canDecrease, `Decrease ${title}`)}
      <Text style={[styles.stepperValue, { color: theme.colors.secondaryText }]}>
        {value}
      </Text>
      {step("add", onIncrease, canIncrease, `Increase ${title}`)}
    </View>
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
  swatchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 14,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  // Exactly four to a row: the cells tile to 100% with no column gap (any gap
  // would overflow the row and drop the fourth swatch onto the next line), and
  // the spacing between swatches comes from centering them in their cells.
  swatch: { width: "25%", alignItems: "center", gap: 5 },
  swatchRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchDisc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchGlyph: { fontSize: 15, fontWeight: "600" },
  swatchLabel: { fontSize: 11 },
  stepperButton: {
    width: 34,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: { fontSize: 15, minWidth: 44, textAlign: "center" },
});
