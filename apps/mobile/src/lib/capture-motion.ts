import { PULL_READY } from "./capture-gesture";

export type FreshNoteTransition = "layer" | "pause";
export type FreshNoteHint = "gradient" | "sheet";

// Study A: 1200ms timeline, released at .27; travel ends at .90.
export const LAYER_TRAVEL_MS = 756;
export const LAYER_RELEASE_MS = 876;
export const PAUSE_RELEASE_MS = 818;

export const clampUnit = (value: number): number => {
  "worklet";
  return Math.max(0, Math.min(1, value));
};

export const sheetStartY = (visibleHeight: number, pull: number, hint: FreshNoteHint, bottomInset = 0): number => {
  "worklet";
  const height = Math.max(1, visibleHeight);
  if (hint === "gradient") return height * 1.12;
  return height - Math.min(92 + bottomInset, height * .35) * clampUnit(pull / PULL_READY);
};

/** Release progress expressed in the original web study's timeline. */
export const releaseFraction = (progress: number): number => {
  "worklet";
  return .27 + .73 * clampUnit(progress);
};

export const pauseOldOpacity = (progress: number): number => {
  "worklet";
  return 1 - clampUnit((releaseFraction(progress) - .34) / .27);
};

export const freshPlaceholderOpacity = (progress: number, transition: FreshNoteTransition): number => {
  "worklet";
  const t = releaseFraction(progress);
  return transition === "layer" ? clampUnit((t - .88) / .12) : clampUnit((t - .68) / .28);
};

export const releaseHintOpacity = (progress: number, transition: FreshNoteTransition): number => {
  "worklet";
  return 1 - clampUnit((releaseFraction(progress) - .27) / (transition === "pause" ? .16 : .14));
};
