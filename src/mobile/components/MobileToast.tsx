import { useEffect } from "react";
import type { MobileToastState } from "../navigation";

type MobileToastProps = {
  toast: MobileToastState | null;
  onClose: () => void;
};

export function MobileToast({ toast, onClose }: MobileToastProps) {
  useEffect(() => {
    if (!toast) {
      return;
    }
    const id = window.setTimeout(() => {
      onClose();
    }, 3000);
    return () => window.clearTimeout(id);
  }, [onClose, toast]);

  if (!toast) {
    return null;
  }

  return (
    <div className={`mobile-toast mobile-toast-${toast.tone || "info"}`} role="status" aria-live="polite">
      {toast.message}
    </div>
  );
}
