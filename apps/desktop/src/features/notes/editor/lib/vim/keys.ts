/**
 * The keyboard grammar: counts, registers, operators, motions, text objects
 * and single-key actions.
 *
 * `parseVimKey` is a pure reducer over `VimPending`. Feeding it one key at a
 * time either extends the pending command (`3d2i` …), produces a finished
 * `VimCommand`, or reports that the key means nothing in this mode. Keeping it
 * separate from ProseMirror is what makes `d2aw` testable without a DOM.
 */

export type VimMode = "normal" | "insert" | "visual" | "visual-line";

export type VimOperator = "d" | "c" | "y" | "gu" | "gU" | "g~" | ">" | "<";

export type VimMotion =
  | { type: "left" }
  | { type: "right" }
  | { type: "down" }
  | { type: "up" }
  | { type: "halfPageDown" }
  | { type: "halfPageUp" }
  | { type: "jumpDown" }
  | { type: "jumpUp" }
  | { type: "wordForward"; big: boolean }
  | { type: "wordBackward"; big: boolean }
  | { type: "wordEnd"; big: boolean }
  | { type: "wordEndBackward"; big: boolean }
  | { type: "lineStart" }
  | { type: "firstNonBlank" }
  | { type: "lineEnd" }
  | { type: "lastNonBlank" }
  | { type: "gotoLine"; line: number | "last" }
  | { type: "findChar"; char: string; forward: boolean; till: boolean }
  | { type: "repeatFind"; reverse: boolean }
  | { type: "paragraphForward" }
  | { type: "paragraphBackward" }
  | { type: "matchBracket" };

export type VimTextObject = {
  kind: "word" | "paragraph" | "quote" | "bracket";
  inner: boolean;
  big?: boolean;
  quote?: string;
  open?: string;
  close?: string;
};

export type VimAction =
  | "insertBefore"
  | "insertAfter"
  | "insertLineStart"
  | "insertLineEnd"
  | "openBelow"
  | "openAbove"
  | "deleteChar"
  | "deleteCharBefore"
  | "deleteToLineEnd"
  | "changeToLineEnd"
  | "yankLine"
  | "substituteChar"
  | "substituteLine"
  | "paste"
  | "pasteBefore"
  | "undo"
  | "redo"
  | "joinLines"
  | "toggleCase"
  | "visualChar"
  | "visualLine"
  | "visualReselect"
  | "visualSwapEnds"
  | "repeatChange"
  | "scrollCenter"
  | "scrollTop"
  | "scrollBottom";

export type VimCommand =
  | {
      type: "motion";
      motion: VimMotion;
      count: number;
      operator: VimOperator | null;
      register: string | null;
    }
  | {
      type: "textObject";
      object: VimTextObject;
      count: number;
      operator: VimOperator | null;
      register: string | null;
    }
  | {
      type: "lineOperator";
      operator: VimOperator;
      count: number;
      register: string | null;
    }
  | {
      type: "visualOperator";
      operator: VimOperator | "p";
      register: string | null;
    }
  | {
      type: "action";
      action: VimAction;
      count: number;
      register: string | null;
    }
  | { type: "replaceChar"; char: string; count: number };

export type VimAwaiting =
  | null
  | "g"
  | "z"
  | "register"
  | "replace"
  | "find-f"
  | "find-F"
  | "find-t"
  | "find-T"
  | "object-i"
  | "object-a";

export type VimPending = {
  count: string;
  register: string | null;
  operator: VimOperator | null;
  operatorCount: string;
  awaiting: VimAwaiting;
};

export type VimKeyEvent = {
  /** Layout-normalised command key (`v`, `V`, `d`, `4`, `$`, …). */
  key: string;
  /** The literal character the user typed, used by `f`, `t` and `r`. */
  char: string | null;
  ctrl: boolean;
};

export type VimParseResult =
  | { kind: "pending"; pending: VimPending }
  | { kind: "command"; command: VimCommand; pending: VimPending }
  | { kind: "unhandled"; pending: VimPending };

export const emptyPending = (): VimPending => ({
  count: "",
  register: null,
  operator: null,
  operatorCount: "",
  awaiting: null,
});

export const isPendingActive = (pending: VimPending) =>
  pending.count !== "" ||
  pending.register !== null ||
  pending.operator !== null ||
  pending.operatorCount !== "" ||
  pending.awaiting !== null;

/** What the user has typed so far, for the mode indicator. */
export const describePending = (pending: VimPending) => {
  const awaitingLabel: Record<Exclude<VimAwaiting, null>, string> = {
    g: "g",
    z: "z",
    register: '"',
    replace: "r",
    "find-f": "f",
    "find-F": "F",
    "find-t": "t",
    "find-T": "T",
    "object-i": "i",
    "object-a": "a",
  };
  return [
    pending.register ? `"${pending.register}` : "",
    pending.count,
    pending.operator ?? "",
    pending.operatorCount,
    pending.awaiting ? awaitingLabel[pending.awaiting] : "",
  ].join("");
};

const resolveCount = (pending: VimPending) => {
  const outer = pending.count === "" ? 1 : Number.parseInt(pending.count, 10);
  const inner =
    pending.operatorCount === "" ? 1 : Number.parseInt(pending.operatorCount, 10);
  return Math.max(1, outer * inner);
};

const OPERATORS: Record<string, VimOperator> = {
  d: "d",
  c: "c",
  y: "y",
  ">": ">",
  "<": "<",
};

const BRACKET_OBJECTS: Record<string, { open: string; close: string }> = {
  "(": { open: "(", close: ")" },
  ")": { open: "(", close: ")" },
  b: { open: "(", close: ")" },
  "[": { open: "[", close: "]" },
  "]": { open: "[", close: "]" },
  "{": { open: "{", close: "}" },
  "}": { open: "{", close: "}" },
  B: { open: "{", close: "}" },
  "<": { open: "<", close: ">" },
  ">": { open: "<", close: ">" },
};

const QUOTE_OBJECTS = new Set(['"', "'", "`"]);

const MOTIONS: Record<string, VimMotion> = {
  h: { type: "left" },
  Backspace: { type: "left" },
  ArrowLeft: { type: "left" },
  l: { type: "right" },
  " ": { type: "right" },
  ArrowRight: { type: "right" },
  j: { type: "down" },
  ArrowDown: { type: "down" },
  "+": { type: "down" },
  k: { type: "up" },
  ArrowUp: { type: "up" },
  "-": { type: "up" },
  w: { type: "wordForward", big: false },
  W: { type: "wordForward", big: true },
  b: { type: "wordBackward", big: false },
  B: { type: "wordBackward", big: true },
  e: { type: "wordEnd", big: false },
  E: { type: "wordEnd", big: true },
  "0": { type: "lineStart" },
  Home: { type: "lineStart" },
  "^": { type: "firstNonBlank" },
  $: { type: "lineEnd" },
  End: { type: "lineEnd" },
  "}": { type: "paragraphForward" },
  "{": { type: "paragraphBackward" },
  "%": { type: "matchBracket" },
  ";": { type: "repeatFind", reverse: false },
  ",": { type: "repeatFind", reverse: true },
};

/** Motions that always take whole lines, and therefore make an operator linewise. */
export const isLinewiseMotion = (motion: VimMotion) =>
  motion.type === "down" ||
  motion.type === "up" ||
  motion.type === "jumpDown" ||
  motion.type === "jumpUp" ||
  motion.type === "halfPageDown" ||
  motion.type === "halfPageUp" ||
  motion.type === "gotoLine";

/**
 * Inclusive motions include the character under the resting cursor when an
 * operator consumes them — the difference between `dw` and `de`.
 */
export const isInclusiveMotion = (motion: VimMotion) =>
  motion.type === "wordEnd" ||
  motion.type === "lineEnd" ||
  motion.type === "lastNonBlank" ||
  motion.type === "matchBracket" ||
  (motion.type === "findChar" && motion.forward) ||
  (motion.type === "repeatFind" && !motion.reverse);

const command = (next: VimCommand): VimParseResult => ({
  kind: "command",
  command: next,
  pending: emptyPending(),
});

const pendingResult = (pending: VimPending): VimParseResult => ({
  kind: "pending",
  pending,
});

const rejected = (): VimParseResult => ({
  kind: "unhandled",
  pending: emptyPending(),
});

const motionCommand = (pending: VimPending, motion: VimMotion) =>
  command({
    type: "motion",
    motion,
    count: resolveCount(pending),
    operator: pending.operator,
    register: pending.register,
  });

const objectCommand = (pending: VimPending, object: VimTextObject) =>
  command({
    type: "textObject",
    object,
    count: resolveCount(pending),
    operator: pending.operator,
    register: pending.register,
  });

const actionCommand = (pending: VimPending, action: VimAction) =>
  command({
    type: "action",
    action,
    count: resolveCount(pending),
    register: pending.register,
  });

const resolveTextObject = (
  key: string,
  inner: boolean
): VimTextObject | null => {
  if (key === "w" || key === "W") {
    return { kind: "word", inner, big: key === "W" };
  }
  if (key === "p") {
    return { kind: "paragraph", inner };
  }
  if (QUOTE_OBJECTS.has(key)) {
    return { kind: "quote", inner, quote: key };
  }
  const bracket = BRACKET_OBJECTS[key];
  if (bracket) {
    return { kind: "bracket", inner, open: bracket.open, close: bracket.close };
  }
  return null;
};

/**
 * Advance the pending command by one key.
 *
 * `mode` matters: in Visual mode `i`/`a` open a text object instead of entering
 * Insert, and `d`/`y`/`c` act on the selection immediately instead of waiting
 * for a motion.
 */
export const parseVimKey = (
  pending: VimPending,
  event: VimKeyEvent,
  mode: VimMode
): VimParseResult => {
  const { key, char, ctrl } = event;
  const visual = mode === "visual" || mode === "visual-line";
  const operatorPending = pending.operator !== null;

  if (pending.awaiting === "register") {
    if (char && /^[a-zA-Z0-9"_]$/.test(char)) {
      return pendingResult({ ...pending, register: char, awaiting: null });
    }
    return rejected();
  }

  if (pending.awaiting === "replace") {
    if (char && char.length === 1) {
      return command({
        type: "replaceChar",
        char,
        count: resolveCount(pending),
      });
    }
    return rejected();
  }

  if (
    pending.awaiting === "find-f" ||
    pending.awaiting === "find-F" ||
    pending.awaiting === "find-t" ||
    pending.awaiting === "find-T"
  ) {
    if (!char || char.length !== 1) {
      return rejected();
    }
    const forward = pending.awaiting === "find-f" || pending.awaiting === "find-t";
    const till = pending.awaiting === "find-t" || pending.awaiting === "find-T";
    return motionCommand({ ...pending, awaiting: null }, {
      type: "findChar",
      char,
      forward,
      till,
    });
  }

  if (pending.awaiting === "object-i" || pending.awaiting === "object-a") {
    const object = resolveTextObject(key, pending.awaiting === "object-i");
    if (!object) {
      return rejected();
    }
    return objectCommand({ ...pending, awaiting: null }, object);
  }

  if (pending.awaiting === "z") {
    const scroll: Record<string, VimAction> = {
      z: "scrollCenter",
      t: "scrollTop",
      b: "scrollBottom",
    };
    const action = scroll[key];
    if (!action) {
      return rejected();
    }
    return actionCommand({ ...pending, awaiting: null }, action);
  }

  if (pending.awaiting === "g") {
    const base = { ...pending, awaiting: null } satisfies VimPending;
    if (key === "g") {
      return motionCommand(base, {
        type: "gotoLine",
        line: pending.count === "" ? 1 : Number.parseInt(pending.count, 10),
      });
    }
    if (key === "e" || key === "E") {
      return motionCommand(base, { type: "wordEndBackward", big: key === "E" });
    }
    if (key === "_") {
      return motionCommand(base, { type: "lastNonBlank" });
    }
    if (!operatorPending && (key === "u" || key === "U" || key === "~")) {
      const operator: VimOperator = key === "u" ? "gu" : key === "U" ? "gU" : "g~";
      if (visual) {
        return command({
          type: "visualOperator",
          operator,
          register: pending.register,
        });
      }
      return pendingResult({ ...base, operator });
    }
    if (key === "v" && !visual && !operatorPending) {
      return actionCommand(base, "visualReselect");
    }
    return rejected();
  }

  // Counts. A leading `0` is the line-start motion, not a digit.
  if (/^[0-9]$/.test(key) && !(key === "0" && (operatorPending ? pending.operatorCount : pending.count) === "")) {
    return pendingResult(
      operatorPending
        ? { ...pending, operatorCount: pending.operatorCount + key }
        : { ...pending, count: pending.count + key }
    );
  }

  if (key === '"' && !operatorPending) {
    return pendingResult({ ...pending, awaiting: "register" });
  }

  if (key === "g") {
    return pendingResult({ ...pending, awaiting: "g" });
  }

  if (key === "z" && !operatorPending && !visual) {
    return pendingResult({ ...pending, awaiting: "z" });
  }

  if (ctrl) {
    if (key === "d") {
      return motionCommand(pending, { type: "halfPageDown" });
    }
    if (key === "u") {
      return motionCommand(pending, { type: "halfPageUp" });
    }
    if (key === "j") {
      return motionCommand(pending, { type: "jumpDown" });
    }
    if (key === "k") {
      return motionCommand(pending, { type: "jumpUp" });
    }
    if (key === "r" && !visual && !operatorPending) {
      return actionCommand(pending, "redo");
    }
    return rejected();
  }

  // Operators. In Visual mode they run against the selection right away.
  const operator = OPERATORS[key];
  if (operator) {
    if (visual) {
      return command({
        type: "visualOperator",
        operator,
        register: pending.register,
      });
    }
    if (operatorPending) {
      // `dd`, `yy`, `>>` — an operator repeated is linewise. (`guu` and `gUU`
      // are handled below, since `u` and `U` are not operators on their own.)
      if (pending.operator !== operator) {
        return rejected();
      }
      return command({
        type: "lineOperator",
        operator: pending.operator!,
        count: resolveCount(pending),
        register: pending.register,
      });
    }
    return pendingResult({ ...pending, operator });
  }

  // `guu` / `gUU` — the second key of a `g` operator, doubled.
  if (
    operatorPending &&
    pending.operator!.startsWith("g") &&
    (key === "u" || key === "U" || key === "~")
  ) {
    return command({
      type: "lineOperator",
      operator: pending.operator!,
      count: resolveCount(pending),
      register: pending.register,
    });
  }

  if (key === "i" || key === "a") {
    if (visual || operatorPending) {
      return pendingResult({
        ...pending,
        awaiting: key === "i" ? "object-i" : "object-a",
      });
    }
    return actionCommand(pending, key === "i" ? "insertBefore" : "insertAfter");
  }

  if (key === "f" || key === "F" || key === "t" || key === "T") {
    return pendingResult({ ...pending, awaiting: `find-${key}` as VimAwaiting });
  }

  if (key === "G") {
    return motionCommand(pending, {
      type: "gotoLine",
      line: pending.count === "" ? "last" : Number.parseInt(pending.count, 10),
    });
  }

  const motion = MOTIONS[key];
  if (motion) {
    return motionCommand(pending, motion);
  }

  if (operatorPending) {
    // Anything else after an operator is not a motion — drop the command.
    return rejected();
  }

  if (visual) {
    const visualActions: Record<string, VimCommand> = {
      x: { type: "visualOperator", operator: "d", register: pending.register },
      s: { type: "visualOperator", operator: "c", register: pending.register },
      p: { type: "visualOperator", operator: "p", register: pending.register },
      P: { type: "visualOperator", operator: "p", register: pending.register },
      "~": { type: "visualOperator", operator: "g~", register: pending.register },
      u: { type: "visualOperator", operator: "gu", register: pending.register },
      U: { type: "visualOperator", operator: "gU", register: pending.register },
      D: { type: "visualOperator", operator: "d", register: pending.register },
      X: { type: "visualOperator", operator: "d", register: pending.register },
      C: { type: "visualOperator", operator: "c", register: pending.register },
      Y: { type: "visualOperator", operator: "y", register: pending.register },
      S: { type: "visualOperator", operator: "c", register: pending.register },
      };
    if (key === "o") {
      return actionCommand(pending, "visualSwapEnds");
    }
    if (key === "v") {
      return actionCommand(pending, "visualChar");
    }
    if (key === "V") {
      return actionCommand(pending, "visualLine");
    }
    if (key === "r") {
      return pendingResult({ ...pending, awaiting: "replace" });
    }
    const visualCommand = visualActions[key];
    if (visualCommand) {
      return command(visualCommand);
    }
    return rejected();
  }

  const actions: Record<string, VimAction> = {
    I: "insertLineStart",
    A: "insertLineEnd",
    o: "openBelow",
    O: "openAbove",
    x: "deleteChar",
    X: "deleteCharBefore",
    D: "deleteToLineEnd",
    C: "changeToLineEnd",
    Y: "yankLine",
    s: "substituteChar",
    S: "substituteLine",
    p: "paste",
    P: "pasteBefore",
    u: "undo",
    J: "joinLines",
    "~": "toggleCase",
    v: "visualChar",
    V: "visualLine",
    ".": "repeatChange",
  };
  const action = actions[key];
  if (action) {
    return actionCommand(pending, action);
  }

  if (key === "r") {
    return pendingResult({ ...pending, awaiting: "replace" });
  }

  return rejected();
};
