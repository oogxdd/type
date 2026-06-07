import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app";

const isIosDevice = () => {
  if (typeof window === "undefined") {
    return false;
  }
  const { userAgent, platform, maxTouchPoints } = window.navigator;
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
};

const lockIosZoom = () => {
  if (!isIosDevice()) {
    return;
  }

  const viewportMeta = document.querySelector<HTMLMetaElement>("meta[name='viewport']");
  if (viewportMeta) {
    const contentTokens = viewportMeta.content
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .filter((token) => !/^(maximum-scale|minimum-scale|user-scalable)\s*=/.test(token));
    viewportMeta.content = [
      ...contentTokens,
      "maximum-scale=1",
      "minimum-scale=1",
      "user-scalable=no",
    ].join(", ");
  }

  const preventGestureZoom = (event: Event) => {
    event.preventDefault();
  };
  const preventPinchZoom = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  };
  let lastTouchEndAt = 0;
  const preventDoubleTapZoom = (event: TouchEvent) => {
    const now = Date.now();
    if (now - lastTouchEndAt < 280) {
      event.preventDefault();
    }
    lastTouchEndAt = now;
  };

  document.addEventListener("gesturestart", preventGestureZoom as EventListener);
  document.addEventListener("gesturechange", preventGestureZoom as EventListener);
  document.addEventListener("gestureend", preventGestureZoom as EventListener);
  document.addEventListener("touchstart", preventPinchZoom, { passive: false });
  document.addEventListener("touchmove", preventPinchZoom, { passive: false });
  document.addEventListener("touchend", preventDoubleTapZoom, { passive: false });
};

export const mountApp = () => {
  lockIosZoom();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};
