import { useEffect, type ReactNode } from "react";

import { useAppearance } from "@/state/appearance-store";
import { APP_EXTENSIONS } from "@/lib/extensions";
import { useNotesStore } from "@/state/notes-store";
import { useProfilesStore } from "@/state/profiles-store";
import { SecurityLockScreen } from "@/components/security/lock-screen";
import {
  selectIsLocked,
  unlockSecurity,
  useSecurityStore,
} from "@/state/security-store";
import { hideLaunchSplash } from "./launch-screen";

function StartupScreen({ theme }: { theme: "light" | "dark" }) {
  return (
    <div className={`startup-screen startup-screen-${theme}`} aria-label="Starting Type">
      <img className="startup-logo" src="/type-splash-logo.png" alt="Type logo" />
    </div>
  );
}

function LaunchReveal({ children }: { children: ReactNode }) {
  useEffect(() => {
    hideLaunchSplash();
  }, []);

  return <>{children}</>;
}

export function AppReadinessGate({ children }: { children: ReactNode }) {
  const theme = useAppearance((state) => state.theme);
  const hasSnapshot = useProfilesStore((state) => Boolean(state.snapshot));
  const activeProfileId = useProfilesStore(
    (state) => state.snapshot?.activeProfileId ?? null
  );
  const hasTree = useNotesStore((state) => Boolean(state.tree));

  const appReady = hasSnapshot && (!activeProfileId || hasTree);
  if (!appReady) {
    return <StartupScreen theme={theme} />;
  }

  return <LaunchReveal>{children}</LaunchReveal>;
}

export function AppSecurityGate({ children }: { children: ReactNode }) {
  const theme = useAppearance((state) => state.theme);
  const securityState = useSecurityStore((state) => state.securityState);
  const securityBusy = useSecurityStore((state) => state.busy);
  const securityError = useSecurityStore((state) => state.error);
  const isLocked = useSecurityStore(selectIsLocked);

  if (!APP_EXTENSIONS.security) {
    return <>{children}</>;
  }

  if (!securityState) {
    return <StartupScreen theme={theme} />;
  }

  if (securityState.encryption_enabled && isLocked) {
    return (
      <LaunchReveal>
        <SecurityLockScreen
          busy={securityBusy}
          error={securityError}
          onUnlock={async (password) => {
            await unlockSecurity(password);
          }}
        />
      </LaunchReveal>
    );
  }

  return <>{children}</>;
}
