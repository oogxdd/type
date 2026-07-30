// Device-local visual preferences (background, text color, editor font size)
// and the pure derivation from them to a Theme.
//
// Appearance is deliberately *not* part of ProfileSettings: it belongs to the
// phone, not to the notes. Nothing here reaches a notes root, so no color
// choice can ever ride a git sync to another device.
//
// Only two color knobs are stored. Everything else in the palette — surface,
// border, secondary text, and whether the UI is in its dark variant — is
// derived from the chosen background and text, so an arbitrary pair still
// produces a coherent theme. `readableOn` puts a WCAG-AA floor under the body
// text/background contrast: the point is to make "white on white" impossible
// (it would lock the user out of the very screen that fixes it), not to
// restyle sensible choices.

export type Theme = {
  dark: boolean;
  colors: {
    background: string;
    surface: string;
    text: string;
    secondaryText: string;
    border: string;
    accent: string;
    danger: string;
    success: string;
  };
  /** Body text size for the capture page and the note editor. */
  fontSize: number;
  lineHeight: number;
};

export type BackgroundId =
  | "system"
  | "white"
  | "paper"
  | "sepia"
  | "sage"
  | "slate"
  | "ink"
  | "black";

export type TextColorId =
  | "system"
  | "ink"
  | "graphite"
  | "sepia"
  | "blue"
  | "green"
  | "plum"
  | "paper";

export type Appearance = {
  background: BackgroundId;
  textColor: TextColorId;
  fontSize: number;
};

/** A palette entry; `color: null` means "follow the system light/dark theme". */
export type AppearanceOption<Id extends string> = {
  id: Id;
  label: string;
  color: string | null;
};

export const MIN_FONT_SIZE = 13;
export const MAX_FONT_SIZE = 28;
export const DEFAULT_FONT_SIZE = 17;

export const DEFAULT_APPEARANCE: Appearance = {
  background: "system",
  textColor: "system",
  fontSize: DEFAULT_FONT_SIZE,
};

export const BACKGROUNDS: AppearanceOption<BackgroundId>[] = [
  { id: "system", label: "System", color: null },
  { id: "white", label: "White", color: "#ffffff" },
  { id: "paper", label: "Paper", color: "#faf7f0" },
  { id: "sepia", label: "Sepia", color: "#f4ecd8" },
  { id: "sage", label: "Sage", color: "#eaf0ea" },
  { id: "slate", label: "Slate", color: "#2b2f36" },
  { id: "ink", label: "Ink", color: "#101012" },
  { id: "black", label: "Black", color: "#000000" },
];

export const TEXT_COLORS: AppearanceOption<TextColorId>[] = [
  { id: "system", label: "System", color: null },
  { id: "ink", label: "Ink", color: "#18181b" },
  { id: "graphite", label: "Graphite", color: "#4b5563" },
  { id: "sepia", label: "Sepia", color: "#5b4636" },
  { id: "blue", label: "Blue", color: "#1d4ed8" },
  { id: "green", label: "Green", color: "#166534" },
  { id: "plum", label: "Plum", color: "#7e22ce" },
  { id: "paper", label: "Paper", color: "#f4f4f5" },
];

// The system light/dark palettes. Accent/danger/success are taken from
// whichever of the two matches the resolved background's darkness, so a custom
// background still gets a blue that reads on it.
const LIGHT_BASE = {
  background: "#ffffff",
  text: "#18181b",
  accent: "#2563eb",
  danger: "#dc2626",
  success: "#16a34a",
};
const DARK_BASE = {
  background: "#101012",
  text: "#f4f4f5",
  accent: "#60a5fa",
  danger: "#f87171",
  success: "#4ade80",
};

/** WCAG AA for body text; the floor `readableOn` enforces. */
const MIN_BODY_CONTRAST = 4.5;
/** A looser floor for accents — they are labels and glyphs, not paragraphs. */
const MIN_ACCENT_CONTRAST = 3;
/** How finely `readableOn` walks a color toward the contrasting pole. */
const READABILITY_STEPS = 20;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const parseHex = (hex: string): [number, number, number] => {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
};

const toHex = (channels: number[]): string =>
  `#${channels
    .map((channel) =>
      Math.round(clamp01(channel / 255) * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;

/** Blend `from` toward `to`; t=0 keeps `from`, t=1 returns `to`. */
export const mix = (from: string, to: string, t: number): string => {
  const a = parseHex(from);
  const b = parseHex(to);
  const ratio = clamp01(t);
  return toHex(a.map((channel, index) => channel + (b[index] - channel) * ratio));
};

/** WCAG relative luminance. */
export const luminance = (hex: string): number => {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrastRatio = (a: string, b: string): number => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

/**
 * True when white text reads better on `hex` than black does — the crossover
 * that decides the whole dark/light variant, including status bar and keyboard
 * appearance.
 */
export const isDarkColor = (hex: string): boolean =>
  contrastRatio(hex, "#ffffff") > contrastRatio(hex, "#000000");

/**
 * Nudge `text` toward whichever pole (white/black) reads better on
 * `background` until it clears `minRatio`. Every shipped combination already
 * passes, so this only fires on deliberately awkward pairings.
 */
export const readableOn = (
  text: string,
  background: string,
  minRatio: number = MIN_BODY_CONTRAST
): string => {
  if (contrastRatio(text, background) >= minRatio) {
    return text;
  }
  const pole = isDarkColor(background) ? "#ffffff" : "#000000";
  for (let step = 1; step <= READABILITY_STEPS; step += 1) {
    const candidate = mix(text, pole, step / READABILITY_STEPS);
    if (contrastRatio(candidate, background) >= minRatio) {
      return candidate;
    }
  }
  return pole;
};

export const clampFontSize = (size: number): number =>
  Number.isFinite(size)
    ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)))
    : DEFAULT_FONT_SIZE;

/** The background a "System" choice resolves to right now. */
export const systemBackgroundColor = (systemDark: boolean): string =>
  systemDark ? DARK_BASE.background : LIGHT_BASE.background;

/** The text color a "System" choice resolves to on a given background. */
export const systemTextColor = (background: string): string =>
  isDarkColor(background) ? DARK_BASE.text : LIGHT_BASE.text;

export const resolveBackground = (
  id: BackgroundId,
  systemDark: boolean
): string =>
  BACKGROUNDS.find((option) => option.id === id)?.color ??
  systemBackgroundColor(systemDark);

export const resolveTextColor = (id: TextColorId, background: string): string =>
  readableOn(
    TEXT_COLORS.find((option) => option.id === id)?.color ??
      systemTextColor(background),
    background
  );

export const backgroundLabel = (id: BackgroundId): string =>
  BACKGROUNDS.find((option) => option.id === id)?.label ?? "System";

export const textColorLabel = (id: TextColorId): string =>
  TEXT_COLORS.find((option) => option.id === id)?.label ?? "System";

export const deriveTheme = (
  appearance: Appearance,
  systemDark: boolean
): Theme => {
  const background = resolveBackground(appearance.background, systemDark);
  const dark = isDarkColor(background);
  const base = dark ? DARK_BASE : LIGHT_BASE;
  // Chrome (cards, separators) is the background pushed a few percent toward
  // the contrasting pole, which keeps a custom background's hue instead of
  // dropping a fixed gray on top of it.
  const pole = dark ? "#ffffff" : "#000000";
  const text = resolveTextColor(appearance.textColor, background);
  const fontSize = clampFontSize(appearance.fontSize);

  return {
    dark,
    colors: {
      background,
      surface: mix(background, pole, 0.055),
      text,
      secondaryText: mix(text, background, 0.42),
      border: mix(background, pole, 0.13),
      accent: readableOn(base.accent, background, MIN_ACCENT_CONTRAST),
      danger: readableOn(base.danger, background, MIN_ACCENT_CONTRAST),
      success: readableOn(base.success, background, MIN_ACCENT_CONTRAST),
    },
    fontSize,
    lineHeight: Math.round(fontSize * 1.53),
  };
};

/**
 * Defensive read of the persisted file: an id written by a different build (or
 * a hand-edited file) falls back to the default rather than producing a theme
 * with `undefined` colors.
 */
export const normalizeAppearance = (raw: unknown): Appearance => {
  const value = (raw ?? {}) as Partial<Record<keyof Appearance, unknown>>;
  return {
    background: BACKGROUNDS.some((option) => option.id === value.background)
      ? (value.background as BackgroundId)
      : DEFAULT_APPEARANCE.background,
    textColor: TEXT_COLORS.some((option) => option.id === value.textColor)
      ? (value.textColor as TextColorId)
      : DEFAULT_APPEARANCE.textColor,
    fontSize:
      typeof value.fontSize === "number"
        ? clampFontSize(value.fontSize)
        : DEFAULT_APPEARANCE.fontSize,
  };
};
