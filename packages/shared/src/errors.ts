/**
 * Normalize an unknown thrown value into a human-readable message.
 *
 * `catch` clauses receive `unknown`, so the same `error instanceof Error`
 * narrowing was previously inlined dozens of times across features. Use this
 * helper instead so error formatting stays consistent in one place.
 *
 * Note: domain-specific formatters (e.g. the recorder's DOMException handling
 * in `use-audio-recorder`) intentionally do their own thing — this is only the
 * generic fallback.
 */
export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
