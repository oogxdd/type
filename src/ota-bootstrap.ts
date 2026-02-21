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

const startWithOta = async () => {
  setStatus("Checking for updates...");
  const { prepare, start } = await import("@inkibra/tauri-plugin-ota");
  const manifestUrl = import.meta.env.VITE_OTA_MANIFEST_URL?.trim();

  if (manifestUrl) {
    try {
      await prepare(manifestUrl);
    } catch (error) {
      console.warn("[OTA] prepare failed; falling back to bundled app", error);
    }
  } else {
    console.info("[OTA] VITE_OTA_MANIFEST_URL not set; using bundled app");
  }

  setStatus("Starting app...");
  await start();
};

const bootstrap = async () => {
  if (!isLikelyIosWebView()) {
    await mountBundledApp();
    return;
  }

  try {
    await startWithOta();
  } catch (error) {
    console.error("[OTA] startup failed; mounting bundled app directly", error);
    setStatus("Unable to load update. Starting bundled app...");
    await mountBundledApp();
  }
};

void bootstrap();
