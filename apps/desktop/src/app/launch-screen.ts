import type { ThemeMode } from "@typenotes/shared/types";

export const LIGHT_LAUNCH_BACKGROUND = "#f2f2f5";
export const DARK_LAUNCH_BACKGROUND = "#1c1c22";
const LAUNCH_SPLASH_FADE_MS = 140;

const launchBackgroundForTheme = (theme: ThemeMode) =>
  theme === "dark" ? DARK_LAUNCH_BACKGROUND : LIGHT_LAUNCH_BACKGROUND;

export const applyThemeToDocument = (theme: ThemeMode) => {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const isDark = theme === "dark";
  const background = launchBackgroundForTheme(theme);

  root.classList.toggle("dark", isDark);
  root.setAttribute("data-launch-theme", theme);
  root.style.colorScheme = theme;

  if (document.body) {
    // An inline background would beat the stylesheet's sheer wash, so on a
    // window that actually has a translucent material we leave the body to
    // index.html's `[data-window-material="blur"]` rules and only paint the
    // opaque floor where there is nothing to be translucent against.
    const hasWindowMaterial =
      root.getAttribute("data-window-material") === "blur";
    document.body.style.backgroundColor = hasWindowMaterial ? "" : background;
  }

  const themeColorMeta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"][data-app-theme-color="true"]'
  );
  if (themeColorMeta) {
    themeColorMeta.content = background;
  }
};

export const hideLaunchSplash = () => {
  if (typeof document === "undefined") {
    return;
  }

  const splash = document.getElementById("launch-splash");
  if (!splash || splash.dataset.state === "hiding") {
    return;
  }

  splash.dataset.state = "hiding";
  requestAnimationFrame(() => {
    splash.classList.add("launch-splash-hidden");
    window.setTimeout(() => {
      splash.remove();
    }, LAUNCH_SPLASH_FADE_MS);
  });
};
