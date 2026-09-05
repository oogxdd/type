import { describe, expect, it } from "vitest";
import { resolveVimKeyEvent } from "./key-event";

const keyEvent = (init: Partial<KeyboardEvent>) =>
  ({
    key: "",
    code: "",
    ctrlKey: false,
    shiftKey: false,
    ...init,
  }) as KeyboardEvent;

describe("resolveVimKeyEvent", () => {
  it("passes ASCII through untouched", () => {
    expect(resolveVimKeyEvent(keyEvent({ key: "d", code: "KeyD" }))).toEqual({
      key: "d",
      char: "d",
      ctrl: false,
    });
    expect(resolveVimKeyEvent(keyEvent({ key: "$", code: "Digit4" }))).toMatchObject({
      key: "$",
    });
  });

  it("normalises a non-Latin layout to the US command key", () => {
    // The key at the `d` position on a Cyrillic layout.
    expect(resolveVimKeyEvent(keyEvent({ key: "в", code: "KeyD" }))).toEqual({
      key: "d",
      char: "в",
      ctrl: false,
    });
  });

  it("applies shift when normalising", () => {
    expect(
      resolveVimKeyEvent(keyEvent({ key: "М", code: "KeyV", shiftKey: true }))
    ).toMatchObject({ key: "V" });
  });

  it("normalises punctuation the layout cannot produce", () => {
    expect(
      resolveVimKeyEvent(keyEvent({ key: "ж", code: "Semicolon" }))
    ).toMatchObject({ key: ";" });
    expect(
      resolveVimKeyEvent(keyEvent({ key: "Ж", code: "Semicolon", shiftKey: true }))
    ).toMatchObject({ key: ":" });
    expect(
      resolveVimKeyEvent(keyEvent({ key: "б", code: "Comma" }))
    ).toMatchObject({ key: "," });
  });

  it("lets an ASCII character win over the US table", () => {
    // On a layout that can produce the character, honour what the user sees.
    expect(
      resolveVimKeyEvent(keyEvent({ key: "4", code: "Digit4", shiftKey: true }))
    ).toMatchObject({ key: "4" });
  });

  it("keeps the typed character for f, t and r", () => {
    // `fю` must search for the character the user actually typed.
    expect(resolveVimKeyEvent(keyEvent({ key: "ю", code: "Period" })).char).toBe("ю");
  });

  it("reports named keys and modifiers", () => {
    expect(resolveVimKeyEvent(keyEvent({ key: "Escape", code: "Escape" }))).toEqual({
      key: "Escape",
      char: null,
      ctrl: false,
    });
    expect(
      resolveVimKeyEvent(keyEvent({ key: "d", code: "KeyD", ctrlKey: true })).ctrl
    ).toBe(true);
  });
});
