import { useEffect, useState } from "react";
import type { LayoutMode } from "./navigation";

const TABLET_MAX = 1024;
const PHONE_MAX = 767;

const getCurrentLayout = (): LayoutMode => {
  if (typeof window === "undefined") {
    return "desktop";
  }
  const width = window.innerWidth;
  if (width <= PHONE_MAX) {
    return "phone";
  }
  if (width <= TABLET_MAX) {
    return "tablet";
  }
  return "desktop";
};

export function useLayoutMode() {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(getCurrentLayout);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const update = () => setLayoutMode(getCurrentLayout());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return layoutMode;
}
