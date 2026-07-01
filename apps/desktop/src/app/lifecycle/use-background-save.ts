import { useEffect } from "react";

export function useBackgroundSave(flushSave: () => Promise<void>) {
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        void flushSave();
      }
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
