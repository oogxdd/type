/**
 * Vim registers, shared across notes for the life of the app session.
 *
 * A register keeps the plain text (for `.`-style replays and debugging) and,
 * when the yank came from the editor, the ProseMirror slice — so pasting a
 * bullet list back gives you a bullet list, not five plain paragraphs.
 */

import type { Slice } from "@tiptap/pm/model";

export type VimRegisterValue = {
  text: string;
  linewise: boolean;
  slice?: Slice;
};

const UNNAMED = '"';
const BLACK_HOLE = "_";

const registers = new Map<string, VimRegisterValue>();

// The black hole register is never written, so reading it yields nothing.
export const readRegister = (name: string | null): VimRegisterValue | null =>
  registers.get(name ?? UNNAMED) ?? null;

export const writeRegister = (name: string | null, value: VimRegisterValue) => {
  if (name === BLACK_HOLE) {
    return;
  }
  if (name) {
    registers.set(name, value);
  }
  registers.set(UNNAMED, value);
};

/** Test seam. */
export const clearRegisters = () => registers.clear();
