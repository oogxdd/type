import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_EDITOR_FONT_SIZE,
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
} from "@/shared/constants";
import {
  DEFAULT_DESIGN_PALETTES,
  useAppearance,
} from "./appearance-store";

describe("appearance store", () => {
  beforeEach(() => {
    useAppearance.setState({
      theme: "dark",
      notesListMode: "separate",
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      showVimModeIndicator: false,
      designFont: "helvetica",
      designPalettes: {
        light: { ...DEFAULT_DESIGN_PALETTES.light },
        dark: { ...DEFAULT_DESIGN_PALETTES.dark },
      },
    });
  });

  it("clamps direct font-size changes", () => {
    useAppearance.getState().setEditorFontSize(MAX_EDITOR_FONT_SIZE + 100);
    expect(useAppearance.getState().editorFontSize).toBe(MAX_EDITOR_FONT_SIZE);

    useAppearance.getState().setEditorFontSize(MIN_EDITOR_FONT_SIZE - 100);
    expect(useAppearance.getState().editorFontSize).toBe(MIN_EDITOR_FONT_SIZE);
  });

  it("keeps incremental font-size actions within bounds", () => {
    useAppearance.setState({ editorFontSize: MAX_EDITOR_FONT_SIZE });
    useAppearance.getState().increaseEditorFontSize();
    expect(useAppearance.getState().editorFontSize).toBe(MAX_EDITOR_FONT_SIZE);

    useAppearance.setState({ editorFontSize: MIN_EDITOR_FONT_SIZE });
    useAppearance.getState().decreaseEditorFontSize();
    expect(useAppearance.getState().editorFontSize).toBe(MIN_EDITOR_FONT_SIZE);
  });

  it("resets the editor font size", () => {
    useAppearance.setState({ editorFontSize: MAX_EDITOR_FONT_SIZE });
    useAppearance.getState().resetEditorFontSize();
    expect(useAppearance.getState().editorFontSize).toBe(DEFAULT_EDITOR_FONT_SIZE);
  });

  it("toggles the optional Vim mode label", () => {
    useAppearance.getState().setShowVimModeIndicator(true);
    expect(useAppearance.getState().showVimModeIndicator).toBe(true);
  });

  it("updates and resets colors without mutating the other theme", () => {
    useAppearance.getState().setDesignColor("light", "background", "#ABCDEF");

    expect(useAppearance.getState().designPalettes.light.background).toBe("#abcdef");
    expect(useAppearance.getState().designPalettes.dark).toEqual(
      DEFAULT_DESIGN_PALETTES.dark
    );

    useAppearance.getState().resetDesignPalette("light");
    expect(useAppearance.getState().designPalettes.light).toEqual(
      DEFAULT_DESIGN_PALETTES.light
    );
  });

  it("ignores invalid custom colors", () => {
    useAppearance.getState().setDesignColor("dark", "text", "not-a-color");
    expect(useAppearance.getState().designPalettes.dark.text).toBe(
      DEFAULT_DESIGN_PALETTES.dark.text
    );
  });
});
