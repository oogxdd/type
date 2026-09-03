import { getProfileSyncSettings } from "@/shared/lib/storage";

const LAST_SUCCESSFUL_SYNC_KEY_PREFIX = "typenotes-last-successful-sync:";

export function readLastSuccessfulSyncAt(profileId: string | null): string {
  if (typeof window === "undefined" || !profileId) return "";
  const key = `${LAST_SUCCESSFUL_SYNC_KEY_PREFIX}${profileId}`;
  const stored = window.localStorage.getItem(key);
  if (stored) return stored;

  // Seed the new metadata key from the former per-profile store before the
  // legacy settings migration removes it.
  const legacyValue = getProfileSyncSettings(profileId).lastSuccessfulSyncAt;
  if (legacyValue) window.localStorage.setItem(key, legacyValue);
  return legacyValue;
}

export function writeLastSuccessfulSyncAt(profileId: string, value: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${LAST_SUCCESSFUL_SYNC_KEY_PREFIX}${profileId}`, value);
}

export function formatLastSuccessfulSync(
  value: string,
  nowMs = Date.now()
): string {
  if (!value) return "Sync is off";

  const syncedAt = new Date(value).getTime();
  if (!Number.isFinite(syncedAt)) return "Last sync time unavailable";

  const elapsedMinutes = Math.max(0, Math.floor((nowMs - syncedAt) / 60_000));
  if (elapsedMinutes < 1) return "Last synced just now";
  if (elapsedMinutes === 1) return "Last synced 1 minute ago";
  if (elapsedMinutes < 90) return `Last synced ${elapsedMinutes} minutes ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return "Last synced a few hours ago";
  if (elapsedHours < 48) return "Last synced yesterday";

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `Last synced ${elapsedDays} days ago`;
}
