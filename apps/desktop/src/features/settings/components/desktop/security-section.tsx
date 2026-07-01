import { useMemo, useState } from "react";
import { APP_EXTENSIONS } from "@/features/extensions/registry";
import { useSecurity } from "@/features/security/hooks/security-context";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export function SettingsSecuritySection() {
  if (!APP_EXTENSIONS.security) {
    return null;
  }

  const {
    securityState,
    securityBusy,
    securityError,
    isSecurityEnabled,
    enableSecurity,
    lockSecurity,
    setAutoLockOnBackground,
  } = useSecurity();
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockConfirm, setUnlockConfirm] = useState("");
  const [panicPassword, setPanicPassword] = useState("");
  const [panicConfirm, setPanicConfirm] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const canEnable = useMemo(() => {
    return (
      unlockPassword.trim().length > 0 &&
      panicPassword.trim().length > 0 &&
      unlockConfirm.trim().length > 0 &&
      panicConfirm.trim().length > 0 &&
      !securityBusy
    );
  }, [panicConfirm, panicPassword, securityBusy, unlockConfirm, unlockPassword]);

  const onEnable = async () => {
    if (unlockPassword !== unlockConfirm) {
      setFormError("Unlock password confirmation does not match.");
      return;
    }
    if (panicPassword !== panicConfirm) {
      setFormError("Panic password confirmation does not match.");
      return;
    }
    if (unlockPassword === panicPassword) {
      setFormError("Unlock and panic passwords must be different.");
      return;
    }
    setFormError(null);
    try {
      await enableSecurity(unlockPassword, panicPassword);
      setUnlockPassword("");
      setUnlockConfirm("");
      setPanicPassword("");
      setPanicConfirm("");
    } catch {
      return;
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Security</h2>
      </div>

      <div className="space-y-4">
        {!isSecurityEnabled ? (
          <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
            <h3 className="text-sm font-semibold text-foreground">Enable encryption</h3>
            <label className="grid gap-2 text-sm">
              <span className="text-sm font-medium text-foreground">Unlock password</span>
              <Input
                type="password"
                value={unlockPassword}
                onChange={(event) => setUnlockPassword(event.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-sm font-medium text-foreground">Confirm unlock password</span>
              <Input
                type="password"
                value={unlockConfirm}
                onChange={(event) => setUnlockConfirm(event.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-sm font-medium text-foreground">Panic password</span>
              <Input
                type="password"
                value={panicPassword}
                onChange={(event) => setPanicPassword(event.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-sm font-medium text-foreground">Confirm panic password</span>
              <Input
                type="password"
                value={panicConfirm}
                onChange={(event) => setPanicConfirm(event.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" type="button" disabled={!canEnable} onClick={() => void onEnable()}>
                {securityBusy ? "Enabling..." : "Enable encryption"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Body content will be encrypted at rest. File names and frontmatter stay plaintext.
            </p>
            {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
            {securityError ? <p className="text-xs text-destructive">{securityError}</p> : null}
          </section>
        ) : (
          <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
            <h3 className="text-sm font-semibold text-foreground">Protection</h3>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={Boolean(securityState?.auto_lock_on_background)}
                disabled={securityBusy}
                onChange={(event) => {
                  void setAutoLockOnBackground(event.target.checked);
                }}
              />
              Auto-lock on background
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                type="button"
                variant="secondary"
                disabled={securityBusy}
                onClick={() => {
                  void lockSecurity();
                }}
              >
                {securityBusy ? "Locking..." : "Lock now"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Panic password entered on lock screen wipes local data, resets settings, and creates 3
              dummy notes.
            </p>
            {securityError ? <p className="text-xs text-destructive">{securityError}</p> : null}
          </section>
        )}
      </div>
    </div>
  );
}
