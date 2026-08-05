import { useEffect } from "react";
import { requestObjectSync } from "@/features/sync/api/object-sync-api";

export function useBackgroundSave(flushSave: () => Promise<void>) {
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        void flushSave();
        return;
      }
      // Coming back to the window is the moment edits made on the phone are
      // most likely waiting, so check for them now instead of at the next
      // idle poll.
      void requestObjectSync("foreground").catch(() => {});
    };
    const handleBeforeUnload = () => {
      void flushSave();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [flushSave]);
}
