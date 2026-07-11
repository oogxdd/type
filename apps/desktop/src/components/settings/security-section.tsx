import { useMemo, useState } from "react";
import { APP_EXTENSIONS } from "@/lib/extensions";
import {
  enableSecurity,
  lockSecurity,
  selectIsSecurityEnabled,
  setAutoLockOnBackground,
  useSecurityStore,
} from "@/state/security-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsErrorText,
  SettingsField,
  SettingsHelpText,
  SettingsSection,
} from "./settings-ui";

export function SettingsSecuritySection() {
  if (!APP_EXTENSIONS.security) {
    return null;
  }

  const securityState = useSecurityStore((state) => state.securityState);
  const securityBusy = useSecurityStore((state) => state.busy);
  const securityError = useSecurityStore((state) => state.error);
  const isSecurityEnabled = useSecurityStore(selectIsSecurityEnabled);
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
    <SettingsSection title="Security">
      {!isSecurityEnabled ? (
        <SettingsCard title="Enable encryption">
          <SettingsField label="Unlock password">
            <Input
              type="password"
              value={unlockPassword}
              onChange={(event) => setUnlockPassword(event.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </SettingsField>
          <SettingsField label="Confirm unlock password">
            <Input
              type="password"
              value={unlockConfirm}
              onChange={(event) => setUnlockConfirm(event.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </SettingsField>
          <SettingsField label="Panic password">
            <Input
              type="password"
              value={panicPassword}
              onChange={(event) => setPanicPassword(event.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </SettingsField>
          <SettingsField label="Confirm panic password">
            <Input
              type="password"
              value={panicConfirm}
              onChange={(event) => setPanicConfirm(event.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </SettingsField>
          <SettingsActionRow>
            <Button size="sm" type="button" disabled={!canEnable} onClick={() => void onEnable()}>
              {securityBusy ? "Enabling..." : "Enable encryption"}
            </Button>
          </SettingsActionRow>
          <SettingsHelpText>
            Body content will be encrypted at rest. File names and frontmatter stay plaintext.
          </SettingsHelpText>
          {formError ? <SettingsErrorText>{formError}</SettingsErrorText> : null}
          {securityError ? <SettingsErrorText>{securityError}</SettingsErrorText> : null}
        </SettingsCard>
      ) : (
        <SettingsCard title="Protection">
          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={Boolean(securityState?.auto_lock_on_background)}
              disabled={securityBusy}
              onChange={(event) => {
                void setAutoLockOnBackground(event.target.checked);
              }}
            />
            Auto-lock on background
          </label>
          <SettingsActionRow>
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
          </SettingsActionRow>
          <SettingsHelpText>
            Panic password entered on lock screen wipes local data, resets settings, and creates 3
            dummy notes.
          </SettingsHelpText>
          {securityError ? <SettingsErrorText>{securityError}</SettingsErrorText> : null}
        </SettingsCard>
      )}
    </SettingsSection>
  );
}
