// The state machine behind Settings → Transcription's AssemblyAI section.
//
// AssemblyAI is the only transcription backend on a phone that can be silently
// half-configured: the mode is per working folder (synced), the API key is
// per device (never synced), and nothing goes wrong until the end of the next
// recording. So the screen has to answer three questions at a glance — is a key
// stored, is it the one in the field, and does it actually work — and this file
// owns those answers so they can be tested without a native build.

export type KeyCheck =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "verified" }
  | { status: "failed"; message: string };

export const normalizeApiKey = (value: string): string => value.trim();

export const hasStoredKey = (storedKey: string): boolean =>
  normalizeApiKey(storedKey).length > 0;

/** True when the field holds something other than the key on the device. */
export const isKeyDirty = (draft: string, storedKey: string): boolean =>
  normalizeApiKey(draft) !== normalizeApiKey(storedKey);

/**
 * Enough of the stored key to recognize which one it is, without putting it
 * back on screen. Short keys are masked whole rather than mostly revealed.
 */
export const maskApiKey = (key: string): string => {
  const normalized = normalizeApiKey(key);
  if (!normalized) return "";
  if (normalized.length <= 8) return "•".repeat(normalized.length);
  return `••••${normalized.slice(-4)}`;
};

/**
 * One button, so there is never a "which of these did I need to press?" moment:
 * it saves the typed key when there is one to save, and always ends by asking
 * AssemblyAI whether the key works.
 */
export const keyActionTitle = (draft: string, storedKey: string): string =>
  isKeyDirty(draft, storedKey) ? "Save & Verify Key" : "Verify Key";

export const isKeyActionDisabled = (
  draft: string,
  storedKey: string,
  check: KeyCheck
): boolean => {
  if (check.status === "checking") return true;
  // Nothing to save and nothing stored to verify.
  return !normalizeApiKey(draft) && !hasStoredKey(storedKey);
};

export type SetupNotice = {
  tone: "ok" | "warning" | "info";
  text: string;
};

/**
 * The single line that tells the user where they stand. `mode` is the working
 * folder's effective transcription mode: the key only matters when recordings
 * are actually routed to AssemblyAI, so every other mode says so plainly rather
 * than nagging about a key that will not be used.
 */
export const assemblySetupNotice = (args: {
  routedToAssembly: boolean;
  storedKey: string;
  check: KeyCheck;
}): SetupNotice => {
  const { routedToAssembly, storedKey, check } = args;

  if (check.status === "checking") {
    return { tone: "info", text: "Checking the key with AssemblyAI…" };
  }
  if (check.status === "failed") {
    return { tone: "warning", text: check.message };
  }
  if (!hasStoredKey(storedKey)) {
    return routedToAssembly
      ? {
          tone: "warning",
          text: "No API key on this phone — recordings will be saved but not transcribed. Add a key below.",
        }
      : { tone: "info", text: "No API key on this phone." };
  }
  if (check.status === "verified") {
    return routedToAssembly
      ? {
          tone: "ok",
          text: "Key verified. New recordings will be transcribed on this phone.",
        }
      : {
          tone: "ok",
          text: "Key verified. Pick “AssemblyAI (on this phone)” above to use it.",
        };
  }
  return routedToAssembly
    ? {
        tone: "info",
        text: `Key saved (${maskApiKey(storedKey)}). Verify it to be sure recordings will transcribe.`,
      }
    : { tone: "info", text: `Key saved (${maskApiKey(storedKey)}).` };
};

/**
 * The result of a manual "transcribe pending now". Zero is the interesting
 * case: it means everything is already transcribed, which reads as a no-op
 * unless the screen says so.
 */
export const queuedRecordingsNotice = (queued: number): SetupNotice =>
  queued === 0
    ? { tone: "info", text: "Nothing waiting — every recording is already transcribed." }
    : {
        tone: "ok",
        text:
          queued === 1
            ? "1 recording sent to AssemblyAI."
            : `${queued} recordings sent to AssemblyAI.`,
      };

/**
 * The value shown on the Settings menu row, one level up. A mode that cannot
 * run has to be visible before you open the screen, otherwise the phone looks
 * configured when it isn't.
 */
export const transcriptionRowValue = (
  modeLabel: string,
  routedToAssembly: boolean,
  storedKey: string
): string =>
  routedToAssembly && !hasStoredKey(storedKey) ? `${modeLabel} — no key` : modeLabel;
