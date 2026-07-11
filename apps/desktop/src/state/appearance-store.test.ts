import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_EDITOR_FONT_SIZE,
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
} from "@/lib/constants";
import { useAppearance } from "./appearance-store";

describe("appearance store", () => {
  beforeEach(() => {
    useAppearance.setState({
      theme: "dark",
      notesListMode: "separate",
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
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
});
