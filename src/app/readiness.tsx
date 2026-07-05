import { useEffect, type ReactNode } from "react";

import { useAppearance } from "@/app/state/appearance-store";
import { APP_EXTENSIONS } from "@/features/extensions/registry";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { SecurityLockScreen } from "@/features/security/components/lock-screen";
import { useSecurity } from "@/features/security/hooks/security-context";
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
  const { profilesSnapshot, activeProfileId } = useProfiles();
  const { tree } = useNotesTree();

  const appReady = Boolean(profilesSnapshot) && (!activeProfileId || Boolean(tree));
  if (!appReady) {
    return <StartupScreen theme={theme} />;
  }

  return <LaunchReveal>{children}</LaunchReveal>;
}

export function AppSecurityGate({ children }: { children: ReactNode }) {
  const theme = useAppearance((state) => state.theme);
  const {
    securityState,
    securityBusy,
    securityError,
    isLocked,
    unlockSecurity,
  } = useSecurity();

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
