import { invokeLogged } from "@/shared/api/invoke";
import type {
  ObjectStoreSettings,
  ObjectSyncStatus,
  SyncOutcome,
} from "@typenotes/shared/types";

export const getObjectSyncStatus = (): Promise<ObjectSyncStatus> =>
  invokeLogged<ObjectSyncStatus>("get_object_sync_status");

export const getObjectSyncSettings = (): Promise<ObjectStoreSettings> =>
  invokeLogged<ObjectStoreSettings>("get_object_sync_settings");

export const setObjectSyncSettings = (
  settings: ObjectStoreSettings
): Promise<ObjectSyncStatus> =>
  invokeLogged<ObjectSyncStatus>("set_object_sync_settings", {
    args: { settings },
  });

/** Round-trip the bucket so a bad endpoint or key fails here, in front of the
 *  user, rather than silently in a background round. */
export const testObjectSyncConnection = (
  settings: ObjectStoreSettings
): Promise<void> =>
  invokeLogged<void>("test_object_sync_connection", { args: { settings } });

/** Run a round and wait for it — the manual "Sync now" button. */
export const objectSyncNow = (): Promise<SyncOutcome> =>
  invokeLogged<SyncOutcome>("object_sync_now");

/** Nudge the scheduler; returns immediately. The core decides when a round
 *  actually runs, so this is safe to call on every save. */
export const requestObjectSync = (reason = "auto"): Promise<void> =>
  invokeLogged<void>("request_object_sync", { args: { reason } });

export const collectObjectSyncGarbage = (): Promise<number> =>
  invokeLogged<number>("collect_object_sync_garbage");

/** Turn on end-to-end encryption. Rewrites every stored object under new keys;
 *  local notes are untouched. */
export const enableObjectSyncEncryption = (
  passphrase: string
): Promise<ObjectSyncStatus> =>
  invokeLogged<ObjectSyncStatus>("enable_object_sync_encryption", {
    args: { passphrase },
  });

/** Adopt an already-encrypted bucket on this device. */
export const unlockObjectSyncEncryption = (
  passphrase: string
): Promise<ObjectSyncStatus> =>
  invokeLogged<ObjectSyncStatus>("unlock_object_sync_encryption", {
    args: { passphrase },
  });

/** The pairing QR's payload. Carries bucket credentials *and* the vault key,
 *  so only fetch it when the user explicitly asks to pair a device. */
export const getObjectSyncPairingLink = (): Promise<string> =>
  invokeLogged<string>("get_object_sync_pairing_link");
