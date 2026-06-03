import type { ThemeMode } from "@/types";
import { invokeLogged } from "@/data/invoke";

const hasTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const setNativeTheme = async (theme: ThemeMode): Promise<void> => {
  if (!hasTauriRuntime()) {
    return;
  }

  await invokeLogged("set_native_theme", { theme });
};
