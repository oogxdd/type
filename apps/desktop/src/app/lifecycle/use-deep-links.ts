import { useEffect } from "react";

import {
  parseSyncDeepLink,
  type SyncDeepLinkParams,
} from "@/features/sync/api/local-sync-link";

type UseDeepLinksArgs = {
  onRecordLink: () => void;
  onSyncLink: (sync: SyncDeepLinkParams) => void;
};

export function useDeepLinks({ onRecordLink, onSyncLink }: UseDeepLinksArgs) {
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const handleUrls = (urls: string[]) => {
      for (const url of urls) {
        const sync = parseSyncDeepLink(url);
        if (sync) {
          onSyncLink(sync);
          break;
        }
        if (url.includes("record")) {
          onRecordLink();
          break;
        }
      }
    };

    import("@tauri-apps/plugin-deep-link")
      .then(async (mod) => {
        unlisten = await mod.onOpenUrl(handleUrls);
        try {
          const current = await mod.getCurrent();
          if (current && current.length > 0) {
            handleUrls(current);
          }
        } catch {
          // getCurrent is not available on every platform.
        }
      })
      .catch(() => {});

    return () => unlisten?.();
  }, [onRecordLink, onSyncLink]);
}
