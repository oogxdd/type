// Security domain store: encryption state, lock/unlock, panic handling.
// The UI surface is extension-gated, but the store always tracks backend
// security state — the preview-persistence invariant (plaintext previews must
// never persist for encrypted vaults) depends on it.
import { create } from "zustand";

import * as api from "@/api/security-api";
import { clearPersistedNotePreviews } from "@/lib/storage";
import { getErrorMessage } from "@typenotes/shared/errors";
import type { SecurityState, SecurityUnlockResult } from "@typenotes/shared/types";

type SecurityStoreState = {
  securityState: SecurityState | null;
  busy: boolean;
  error: string | null;
};

export const useSecurityStore = create<SecurityStoreState>(() => ({
  securityState: null,
  busy: false,
  error: null,
}));

export const selectIsSecurityEnabled = (state: SecurityStoreState): boolean =>
  Boolean(state.securityState?.encryption_enabled);
export const selectIsLocked = (state: SecurityStoreState): boolean =>
  Boolean(
    state.securityState?.encryption_enabled && state.securityState?.locked
  );

const resetClientDataAndReload = () => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.clear();
  window.location.reload();
};

export async function refreshSecurityState() {
  useSecurityStore.setState({ busy: true });
  try {
    const securityState = await api.getSecurityState();
    useSecurityStore.setState({ securityState, error: null });
  } catch (error) {
    useSecurityStore.setState({ error: getErrorMessage(error) });
  } finally {
    useSecurityStore.setState({ busy: false });
  }
}

export async function enableSecurity(unlockPassword: string, panicPassword: string) {
  useSecurityStore.setState({ busy: true });
  try {
    const securityState = await api.enableSecurity(unlockPassword, panicPassword);
    // Preview snapshots persisted before encryption hold plaintext titles.
    clearPersistedNotePreviews();
    useSecurityStore.setState({ securityState, error: null });
  } catch (error) {
    useSecurityStore.setState({ error: getErrorMessage(error) });
    throw error;
  } finally {
    useSecurityStore.setState({ busy: false });
  }
}

export async function unlockSecurity(password: string): Promise<SecurityUnlockResult> {
  useSecurityStore.setState({ busy: true });
  try {
    const result = await api.unlockSecurity(password);
    if (result.panic_triggered && result.reset_required) {
      resetClientDataAndReload();
      return result;
    }
    if (result.unlocked) {
      useSecurityStore.setState((state) => ({
        securityState: state.securityState
          ? { ...state.securityState, locked: false }
          : {
              encryption_enabled: false,
              locked: false,
              auto_lock_on_background: true,
            },
        error: null,
      }));
    } else if (result.message) {
      useSecurityStore.setState({ error: result.message });
    }
    return result;
  } catch (error) {
    useSecurityStore.setState({ error: getErrorMessage(error) });
    throw error;
  } finally {
    useSecurityStore.setState({ busy: false });
  }
}

export async function lockSecurity() {
  useSecurityStore.setState({ busy: true });
  try {
    const securityState = await api.lockSecurity();
    useSecurityStore.setState({ securityState, error: null });
  } catch (error) {
    useSecurityStore.setState({ error: getErrorMessage(error) });
    throw error;
  } finally {
    useSecurityStore.setState({ busy: false });
  }
}

export async function setAutoLockOnBackground(enabled: boolean) {
  useSecurityStore.setState({ busy: true });
  try {
    const securityState = await api.setSecurityPreferences(enabled);
    useSecurityStore.setState({ securityState, error: null });
  } catch (error) {
    useSecurityStore.setState({ error: getErrorMessage(error) });
    throw error;
  } finally {
    useSecurityStore.setState({ busy: false });
  }
}

export const clearSecurityError = () => useSecurityStore.setState({ error: null });

/** Fetch initial state and arm auto-lock-on-background. Call once at boot. */
export function initSecurity() {
  void refreshSecurityState();

  let autoLockInFlight = false;
  document.addEventListener("visibilitychange", () => {
    const { securityState } = useSecurityStore.getState();
    const canAutoLock =
      Boolean(securityState?.encryption_enabled) &&
      !securityState?.locked &&
      Boolean(securityState?.auto_lock_on_background);
    if (
      !canAutoLock ||
      document.visibilityState !== "hidden" ||
      autoLockInFlight
    ) {
      return;
    }
    autoLockInFlight = true;
    void lockSecurity()
      .catch(() => {})
      .finally(() => {
        autoLockInFlight = false;
      });
  });
}
