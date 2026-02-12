import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";

export const focusNoScroll = (el: HTMLElement | null) => {
  if (!el) {
    return;
  }
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
};

export const scrollIntoViewIfNeeded = (
  container: HTMLElement | null,
  selector: string
) => {
  if (!container) {
    return;
  }
  const target = container.querySelector<HTMLElement>(selector);
  if (target) {
    target.scrollIntoView({ block: "nearest" });
  }
};

export const escapeSelectorValue = (value: string) => {
  if (typeof window !== "undefined" && window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
};

export const confirmAction = async (message: string) => {
  try {
    const result = window.confirm(message);
    console.log("[confirm] window", message, result);
    return result;
  } catch (error) {
    console.warn("[confirm] window failed, falling back", error);
  }
  try {
    const result = await confirmDialog(message);
    console.log("[confirm] dialog", message, result);
    return Boolean(result);
  } catch (error) {
    console.error("[confirm] dialog failed", error);
    return false;
  }
};
