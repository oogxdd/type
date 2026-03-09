import type { ThemeMode } from "../components/SettingsPanel";
import { invokeLogged } from "./invoke";

const hasTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const setNativeTheme = async (theme: ThemeMode): Promise<void> => {
  if (!hasTauriRuntime()) {
    return;
  }

  await invokeLogged("set_native_theme", { theme });
};
