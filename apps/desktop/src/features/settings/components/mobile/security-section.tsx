import { useMemo, useState } from "react";
import { useSecurity } from "@/features/security/hooks/security-context";
import { Group, InputRow } from "./helpers";

export function MobileSecuritySection() {
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
    <>
      {!isSecurityEnabled ? (
        <Group title="Enable encryption">
          <InputRow
            label="Unlock password"
            value={unlockPassword}
            onChange={setUnlockPassword}
            password
          />
          <InputRow
            label="Confirm unlock password"
            value={unlockConfirm}
            onChange={setUnlockConfirm}
            password
          />
          <InputRow
            label="Panic password"
            value={panicPassword}
            onChange={setPanicPassword}
            password
          />
          <InputRow
            label="Confirm panic password"
            value={panicConfirm}
            onChange={setPanicConfirm}
            password
          />
          <div className="mobile-native-actions single">
            <button
              type="button"
              className="mobile-primary-btn"
              disabled={!canEnable}
              onClick={() => {
                void onEnable();
              }}
            >
              {securityBusy ? "Enabling..." : "Enable encryption"}
            </button>
          </div>
          <p className="mobile-native-note">
            Note bodies are encrypted at rest. File names and frontmatter stay plaintext.
          </p>
          {formError ? <p className="mobile-native-note">{formError}</p> : null}
          {securityError ? <p className="mobile-native-note">{securityError}</p> : null}
        </Group>
      ) : (
        <Group title="Protection">
          <label className="mobile-native-row stat">
            <span className="mobile-native-row-label">Auto-lock on background</span>
            <input
              type="checkbox"
              checked={Boolean(securityState?.auto_lock_on_background)}
              disabled={securityBusy}
              onChange={(event) => {
                void setAutoLockOnBackground(event.target.checked);
              }}
            />
          </label>
          <div className="mobile-native-actions single">
            <button
              type="button"
              className="mobile-secondary-btn"
              disabled={securityBusy}
              onClick={() => {
                void lockSecurity();
              }}
            >
              {securityBusy ? "Locking..." : "Lock now"}
            </button>
          </div>
          <p className="mobile-native-note">
            Panic password on lock screen wipes local data and creates 3 dummy notes.
          </p>
          {securityError ? <p className="mobile-native-note">{securityError}</p> : null}
        </Group>
      )}
    </>
  );
}
