import { describe, expect, it } from "vitest";

import {
  BACKGROUNDS,
  contrastRatio,
  DEFAULT_APPEARANCE,
  DEFAULT_FONT_SIZE,
  deriveTheme,
  isDarkColor,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  mix,
  normalizeAppearance,
  readableOn,
  TEXT_COLORS,
  clampFontSize,
} from "./appearance";

describe("color math", () => {
  it("mixes endpoints and midpoints", () => {
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("clamps the blend ratio", () => {
    expect(mix("#000000", "#ffffff", -1)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 4)).toBe("#ffffff");
  });

  it("expands 3-digit hex", () => {
    expect(mix("#fff", "#fff", 0)).toBe("#ffffff");
  });

  it("computes the WCAG contrast ratio symmetrically", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("classifies backgrounds by which text pole reads better", () => {
    expect(isDarkColor("#101012")).toBe(true);
    expect(isDarkColor("#2b2f36")).toBe(true);
    expect(isDarkColor("#ffffff")).toBe(false);
    expect(isDarkColor("#f4ecd8")).toBe(false);
  });
});

describe("readableOn", () => {
  it("leaves an already-legible color untouched", () => {
    expect(readableOn("#18181b", "#ffffff")).toBe("#18181b");
  });

  it("rescues text that would be invisible", () => {
    const rescued = readableOn("#ffffff", "#ffffff");
    expect(contrastRatio(rescued, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("moves dark text toward white on a dark background", () => {
    const rescued = readableOn("#18181b", "#000000");
    expect(contrastRatio(rescued, "#000000")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every shipped text color legible on every shipped background", () => {
    for (const background of BACKGROUNDS) {
      for (const text of TEXT_COLORS) {
        const theme = deriveTheme(
          { ...DEFAULT_APPEARANCE, background: background.id, textColor: text.id },
          false
        );
        expect(
          contrastRatio(theme.colors.text, theme.colors.background)
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("clampFontSize", () => {
  it("clamps to the supported range and rounds", () => {
    expect(clampFontSize(4)).toBe(MIN_FONT_SIZE);
    expect(clampFontSize(99)).toBe(MAX_FONT_SIZE);
    expect(clampFontSize(17.4)).toBe(17);
  });

  it("falls back to the default for non-numbers", () => {
    expect(clampFontSize(Number.NaN)).toBe(DEFAULT_FONT_SIZE);
  });
});

describe("deriveTheme", () => {
  it("follows the system scheme when the background is System", () => {
    expect(deriveTheme(DEFAULT_APPEARANCE, false).dark).toBe(false);
    expect(deriveTheme(DEFAULT_APPEARANCE, true).dark).toBe(true);
    expect(deriveTheme(DEFAULT_APPEARANCE, true).colors.background).toBe("#101012");
  });

  it("ignores the system scheme once a background is picked", () => {
    const theme = deriveTheme(
      { ...DEFAULT_APPEARANCE, background: "sepia" },
      true
    );
    expect(theme.colors.background).toBe("#f4ecd8");
    expect(theme.dark).toBe(false);
  });

  it("switches to the dark variant for a dark custom background", () => {
    const theme = deriveTheme({ ...DEFAULT_APPEARANCE, background: "slate" }, false);
    expect(theme.dark).toBe(true);
    // Chrome is derived from the background, so it keeps the background's hue.
    expect(theme.colors.surface).not.toBe(theme.colors.background);
    expect(theme.colors.border).not.toBe(theme.colors.background);
  });

  it("reproduces the previous hard-coded default palette", () => {
    const theme = deriveTheme(DEFAULT_APPEARANCE, false);
    expect(theme.colors.text).toBe("#18181b");
    expect(theme.colors.accent).toBe("#2563eb");
    expect(theme.fontSize).toBe(17);
    expect(theme.lineHeight).toBe(26);
  });

  it("scales the line height with the font size", () => {
    const theme = deriveTheme({ ...DEFAULT_APPEARANCE, fontSize: 24 }, false);
    expect(theme.fontSize).toBe(24);
    expect(theme.lineHeight).toBeGreaterThan(24);
  });

  it("clamps an out-of-range persisted font size", () => {
    expect(deriveTheme({ ...DEFAULT_APPEARANCE, fontSize: 400 }, false).fontSize).toBe(
      MAX_FONT_SIZE
    );
  });
});

describe("normalizeAppearance", () => {
  it("round-trips a valid stored value", () => {
    const stored = { background: "paper", textColor: "sepia", fontSize: 19 };
    expect(normalizeAppearance(stored)).toEqual(stored);
  });

  it("falls back to defaults for unknown ids and bad types", () => {
    expect(
      normalizeAppearance({ background: "neon", textColor: 7, fontSize: "big" })
    ).toEqual(DEFAULT_APPEARANCE);
  });

  it("survives null, undefined, and non-objects", () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance("nonsense")).toEqual(DEFAULT_APPEARANCE);
  });
});
