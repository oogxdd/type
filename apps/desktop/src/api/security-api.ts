import { invokeLogged } from "./invoke";
import type { SecurityState, SecurityUnlockResult } from "@typenotes/shared/types";

export const getSecurityState = (): Promise<SecurityState> =>
  invokeLogged<SecurityState>("get_security_state");

export const enableSecurity = (
  unlockPassword: string,
  panicPassword: string
): Promise<SecurityState> =>
  invokeLogged<SecurityState>("enable_security", {
    args: {
      unlock_password: unlockPassword,
      panic_password: panicPassword,
    },
  });

export const lockSecurity = (): Promise<SecurityState> =>
  invokeLogged<SecurityState>("lock_security");

export const unlockSecurity = (
  password: string
): Promise<SecurityUnlockResult> =>
  invokeLogged<SecurityUnlockResult>("unlock_security", {
    args: { password },
  });

export const setSecurityPreferences = (
  autoLockOnBackground: boolean
): Promise<SecurityState> =>
  invokeLogged<SecurityState>("set_security_preferences", {
    args: {
      auto_lock_on_background: autoLockOnBackground,
    },
  });
