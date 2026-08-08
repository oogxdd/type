import { describe, expect, it } from "vitest";

import {
  assemblySetupNotice,
  hasStoredKey,
  isKeyActionDisabled,
  isKeyDirty,
  type KeyCheck,
  keyActionTitle,
  maskApiKey,
  normalizeApiKey,
  queuedRecordingsNotice,
  transcriptionRowValue,
} from "./assembly-setup";

const STORED = "0123456789abcdef0123456789abcdef";
const idle: KeyCheck = { status: "idle" };

describe("key state", () => {
  it("treats whitespace as no key", () => {
    expect(normalizeApiKey("  key  ")).toBe("key");
    expect(hasStoredKey("   ")).toBe(false);
    expect(hasStoredKey(STORED)).toBe(true);
  });

  it("ignores whitespace when deciding whether the field changed", () => {
    expect(isKeyDirty(` ${STORED} `, STORED)).toBe(false);
    expect(isKeyDirty("other", STORED)).toBe(true);
  });

  it("masks the stored key down to a recognizable tail", () => {
    expect(maskApiKey(STORED)).toBe("••••cdef");
    expect(maskApiKey("")).toBe("");
    // Too short to reveal anything from.
    expect(maskApiKey("abc")).toBe("•••");
  });
});

describe("the key action", () => {
  it("saves first only when the field differs from what is stored", () => {
    expect(keyActionTitle("new-key", STORED)).toBe("Save & Verify Key");
    expect(keyActionTitle(STORED, STORED)).toBe("Verify Key");
  });

  it("is available with a stored key and an untouched field", () => {
    expect(isKeyActionDisabled("", STORED, idle)).toBe(false);
  });

  it("is unavailable with nothing typed and nothing stored", () => {
    expect(isKeyActionDisabled("  ", "", idle)).toBe(true);
  });

  it("is unavailable while a check is in flight", () => {
    expect(isKeyActionDisabled(STORED, STORED, { status: "checking" })).toBe(true);
  });
});

describe("the setup notice", () => {
  it("warns that recordings will not transcribe when the mode needs a key it lacks", () => {
    const notice = assemblySetupNotice({
      routedToAssembly: true,
      storedKey: "",
      check: idle,
    });
    expect(notice.tone).toBe("warning");
    expect(notice.text).toContain("not transcribed");
  });

  it("does not nag about a missing key when recordings are routed elsewhere", () => {
    const notice = assemblySetupNotice({
      routedToAssembly: false,
      storedKey: "",
      check: idle,
    });
    expect(notice.tone).toBe("info");
  });

  it("distinguishes a saved key from a proven one", () => {
    const saved = assemblySetupNotice({
      routedToAssembly: true,
      storedKey: STORED,
      check: idle,
    });
    expect(saved.tone).toBe("info");
    expect(saved.text).toContain("••••cdef");
    expect(saved.text).toContain("Verify");

    const verified = assemblySetupNotice({
      routedToAssembly: true,
      storedKey: STORED,
      check: { status: "verified" },
    });
    expect(verified.tone).toBe("ok");
    expect(verified.text).toContain("will be transcribed");
  });

  it("says a verified key is not the selected mode yet", () => {
    const notice = assemblySetupNotice({
      routedToAssembly: false,
      storedKey: STORED,
      check: { status: "verified" },
    });
    expect(notice.tone).toBe("ok");
    expect(notice.text).toContain("Pick");
  });

  it("shows the failure reason verbatim — the fix differs per reason", () => {
    const notice = assemblySetupNotice({
      routedToAssembly: true,
      storedKey: STORED,
      check: {
        status: "failed",
        message: "Could not reach AssemblyAI (key check): timed out",
      },
    });
    expect(notice.tone).toBe("warning");
    expect(notice.text).toBe("Could not reach AssemblyAI (key check): timed out");
  });
});

describe("the manual transcribe action", () => {
  it("says nothing was waiting rather than looking like a no-op", () => {
    expect(queuedRecordingsNotice(0)).toEqual({
      tone: "info",
      text: "Nothing waiting — every recording is already transcribed.",
    });
  });

  it("counts what it sent", () => {
    expect(queuedRecordingsNotice(1).text).toBe("1 recording sent to AssemblyAI.");
    expect(queuedRecordingsNotice(4).text).toBe("4 recordings sent to AssemblyAI.");
  });
});

describe("the settings menu row", () => {
  it("flags a mode that cannot run without opening the screen", () => {
    expect(transcriptionRowValue("AssemblyAI", true, "")).toBe("AssemblyAI — no key");
    expect(transcriptionRowValue("AssemblyAI", true, STORED)).toBe("AssemblyAI");
    expect(transcriptionRowValue("Desktop", false, "")).toBe("Desktop");
  });
});
