// Bridge to the native `BackgroundTask` module (modules/background-task). The
// native side starts an iOS background task the moment the app is backgrounded;
// this only tells it the pre-suspend sync is done. A no-op wherever the module
// is absent — Android, Expo Go, the demo core, or an OTA bundle running on an
// older binary.

import { requireOptionalNativeModule } from "expo-modules-core";

type BackgroundTaskNativeModule = {
  isSupported(): boolean;
  finish(): Promise<void>;
};

const nativeModule =
  requireOptionalNativeModule<BackgroundTaskNativeModule>("BackgroundTask");

/** Release the background time iOS granted. Safe to call when none is held. */
export const finishBackgroundWindow = (): void => {
  void nativeModule?.finish().catch(() => {});
};
