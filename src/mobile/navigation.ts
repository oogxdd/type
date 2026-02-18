import type { SettingsSectionId } from "../components/SettingsPanel";

export type LayoutMode = "desktop" | "tablet" | "phone";

export type MobileRoute =
  | { kind: "home" }
  | { kind: "folders" }
  | { kind: "notes"; folderPath: string }
  | { kind: "recent-date"; bucketId: string }
  | { kind: "editor"; folderPath: string; notePath: string }
  | { kind: "recording"; folderPath: string; autoStart?: boolean }
  | { kind: "settings"; section?: SettingsSectionId };

export type MobileNavigationState = {
  stack: MobileRoute[];
};

export type MobileAction =
  | { type: "push"; route: MobileRoute }
  | { type: "replace"; route: MobileRoute }
  | { type: "pop" }
  | { type: "reset"; route?: MobileRoute };

export type MobileActionSheetAction = {
  id: string;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
};

export type MobileActionSheetState = {
  open: boolean;
  title: string;
  subtitle?: string;
  actions: MobileActionSheetAction[];
};

export type MobileToastState = {
  id: number;
  message: string;
  tone?: "info" | "success" | "error";
};

const DEFAULT_ROUTE: MobileRoute = { kind: "home" };

export const getInitialMobileNavigationState = (
  initialRoute: MobileRoute = DEFAULT_ROUTE
): MobileNavigationState => ({
  stack: [initialRoute],
});

export const getCurrentRoute = (state: MobileNavigationState): MobileRoute =>
  state.stack[state.stack.length - 1] ?? DEFAULT_ROUTE;

export const mobileNavigationReducer = (
  state: MobileNavigationState,
  action: MobileAction
): MobileNavigationState => {
  if (action.type === "push") {
    return { stack: [...state.stack, action.route] };
  }
  if (action.type === "replace") {
    if (state.stack.length === 0) {
      return { stack: [action.route] };
    }
    const stack = state.stack.slice();
    stack[stack.length - 1] = action.route;
    return { stack };
  }
  if (action.type === "pop") {
    if (state.stack.length <= 1) {
      return state;
    }
    return { stack: state.stack.slice(0, -1) };
  }
  return { stack: [action.route ?? DEFAULT_ROUTE] };
};
