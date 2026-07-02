import type { ThemeMode } from "@typenotes/shared/types";

export const LIGHT_LAUNCH_BACKGROUND = "#f5f6fb";
export const DARK_LAUNCH_BACKGROUND = "#14171b";
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
    document.body.style.backgroundColor = background;
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
