// Bridge to the native `RecordingActivity` module (iOS Live Activity for an
// in-progress recording). Every call degrades to a no-op when the native module
// is absent — Android, Expo Go, the demo core, or iOS < 16.2 — so the recorder
// works everywhere and the Lock Screen surface is a pure enhancement.
//
// The module is resolved via `requireOptionalNativeModule`, which returns null
// (instead of throwing) when it isn't linked, mirroring how
// `native-transcription.ts` guards its optional native dependency.

import {
  requireOptionalNativeModule,
  type EventSubscription,
} from "expo-modules-core";

type RecordingActivityNativeModule = {
  isSupported(): boolean;
  consumePendingStop(): boolean;
  start(startedAtMs: number): Promise<boolean>;
  end(): Promise<void>;
  addListener(
    event: "onStopRequested",
    listener: () => void
  ): EventSubscription;
};

const nativeModule =
  requireOptionalNativeModule<RecordingActivityNativeModule>("RecordingActivity");

/** True only on an iOS build where the module is linked and Live Activities are enabled. */
export const isRecordingActivitySupported = (): boolean => {
  try {
    return nativeModule?.isSupported() ?? false;
  } catch {
    return false;
  }
};

/** Start the Lock Screen / Dynamic Island recording activity. No-op if unsupported. */
export const startRecordingActivity = (startedAtMs: number): void => {
  if (!nativeModule) {
    return;
  }
  void nativeModule.start(startedAtMs).catch(() => {});
};

/** End the recording activity. No-op if unsupported. */
export const endRecordingActivity = (): void => {
  if (!nativeModule) {
    return;
  }
  void nativeModule.end().catch(() => {});
};

/**
 * Subscribe to the user tapping "Stop" on the Lock Screen while the app is
 * running (foreground or background-resumed). Returns an unsubscribe function
 * (a no-op when unsupported).
 */
export const addRecordingStopListener = (
  listener: () => void
): (() => void) => {
  if (!nativeModule) {
    return () => {};
  }
  const subscription = nativeModule.addListener("onStopRequested", listener);
  return () => subscription.remove();
};

/**
 * Returns true (once) if the user tapped "Stop" from the Lock Screen while the
 * app was suspended. Call on foreground to honor a stop the live event missed.
 */
export const consumePendingRecordingStop = (): boolean => {
  if (!nativeModule) {
    return false;
  }
  try {
    return nativeModule.consumePendingStop();
  } catch {
    return false;
  }
};
