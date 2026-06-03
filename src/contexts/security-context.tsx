import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "../data/security-api";
import type { SecurityState, SecurityUnlockResult } from "../types";

type SecurityContextValue = {
  securityState: SecurityState | null;
  securityBusy: boolean;
  securityError: string | null;
  isSecurityEnabled: boolean;
  isLocked: boolean;
  enableSecurity: (unlockPassword: string, panicPassword: string) => Promise<void>;
  unlockSecurity: (password: string) => Promise<SecurityUnlockResult>;
  lockSecurity: () => Promise<void>;
  setAutoLockOnBackground: (enabled: boolean) => Promise<void>;
  clearSecurityError: () => void;
};

const SecurityContext = createContext<SecurityContextValue | null>(null);

const resetClientDataAndReload = () => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.clear();
  window.location.reload();
};

export function SecurityProvider({ children }: { children: ReactNode }) {
  const [securityState, setSecurityState] = useState<SecurityState | null>(null);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const autoLockInFlightRef = useRef(false);

  const refreshSecurityState = useCallback(async () => {
    setSecurityBusy(true);
    try {
      const next = await api.getSecurityState();
      setSecurityState(next);
      setSecurityError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSecurityError(message);
    } finally {
      setSecurityBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshSecurityState();
  }, [refreshSecurityState]);

  const enableSecurity = useCallback(
    async (unlockPassword: string, panicPassword: string) => {
      setSecurityBusy(true);
      try {
        const next = await api.enableSecurity(unlockPassword, panicPassword);
        setSecurityState(next);
        setSecurityError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSecurityError(message);
        throw error;
      } finally {
        setSecurityBusy(false);
      }
    },
    []
  );

  const unlockSecurity = useCallback(async (password: string) => {
    setSecurityBusy(true);
    try {
      const result = await api.unlockSecurity(password);
      if (result.panic_triggered && result.reset_required) {
        resetClientDataAndReload();
        return result;
      }
      if (result.unlocked) {
        setSecurityState((prev) =>
          prev
            ? {
                ...prev,
                locked: false,
              }
            : {
                encryption_enabled: false,
                locked: false,
                auto_lock_on_background: true,
              }
        );
        setSecurityError(null);
      } else if (result.message) {
        setSecurityError(result.message);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSecurityError(message);
      throw error;
    } finally {
      setSecurityBusy(false);
    }
  }, []);

  const lockSecurity = useCallback(async () => {
    setSecurityBusy(true);
    try {
      const next = await api.lockSecurity();
      setSecurityState(next);
      setSecurityError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSecurityError(message);
      throw error;
    } finally {
      setSecurityBusy(false);
    }
  }, []);

  const setAutoLockOnBackground = useCallback(async (enabled: boolean) => {
    setSecurityBusy(true);
    try {
      const next = await api.setSecurityPreferences(enabled);
      setSecurityState(next);
      setSecurityError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSecurityError(message);
      throw error;
    } finally {
      setSecurityBusy(false);
    }
  }, []);

  useEffect(() => {
    const canAutoLock =
      Boolean(securityState?.encryption_enabled) &&
      !securityState?.locked &&
      Boolean(securityState?.auto_lock_on_background);
    if (!canAutoLock) {
      return;
    }
    const onVisibility = () => {
      if (document.visibilityState !== "hidden" || autoLockInFlightRef.current) {
        return;
      }
      autoLockInFlightRef.current = true;
      void lockSecurity()
        .catch(() => {})
        .finally(() => {
          autoLockInFlightRef.current = false;
        });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [lockSecurity, securityState]);

  const clearSecurityError = useCallback(() => setSecurityError(null), []);

  const value: SecurityContextValue = {
    securityState,
    securityBusy,
    securityError,
    isSecurityEnabled: Boolean(securityState?.encryption_enabled),
    isLocked: Boolean(securityState?.encryption_enabled && securityState?.locked),
    enableSecurity,
    unlockSecurity,
    lockSecurity,
    setAutoLockOnBackground,
    clearSecurityError,
  };

  return <SecurityContext.Provider value={value}>{children}</SecurityContext.Provider>;
}

export function useSecurity() {
  const context = useContext(SecurityContext);
  if (!context) {
    throw new Error("useSecurity must be used within a SecurityProvider");
  }
  return context;
}
