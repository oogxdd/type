import { OTA_APPLY_PENDING_KEY } from "./constants";

const isLikelyIosWebView = () => {
  if (typeof window === "undefined") {
    return false;
  }
  const { userAgent, platform, maxTouchPoints } = window.navigator;
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
};

const statusEl = document.getElementById("ota-status");
const setStatus = (message: string) => {
  if (statusEl) {
    statusEl.textContent = message;
  }
};

const mountBundledApp = async () => {
  const { mountApp } = await import("./mainApp");
  mountApp();
};

const applyOtaUpdate = async () => {
  window.localStorage.removeItem(OTA_APPLY_PENDING_KEY);

  setStatus("Downloading update...");
  const { prepare, start } = await import("@inkibra/tauri-plugin-ota");
  const manifestUrl = import.meta.env.VITE_OTA_MANIFEST_URL?.trim();

  if (!manifestUrl) {
    console.warn("[OTA] VITE_OTA_MANIFEST_URL not set; falling back to bundled app");
    await mountBundledApp();
    return;
  }

  try {
    await prepare(manifestUrl);
  } catch (error) {
    console.warn("[OTA] prepare failed; falling back to bundled app", error);
  }

  setStatus("Starting app...");
  await start();
};

const bootstrap = async () => {
  const applyPending =
    isLikelyIosWebView() &&
    window.localStorage.getItem(OTA_APPLY_PENDING_KEY) === "true";

  if (applyPending) {
    try {
      await applyOtaUpdate();
    } catch (error) {
      console.error("[OTA] apply failed; mounting bundled app directly", error);
      setStatus("Update failed. Starting bundled app...");
      await mountBundledApp();
    }
    return;
  }

  await mountBundledApp();
};

void bootstrap();
