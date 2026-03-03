import { useState } from "react";

type SecurityLockScreenProps = {
  busy: boolean;
  error: string | null;
  onUnlock: (password: string) => Promise<void>;
};

export function SecurityLockScreen({
  busy,
  error,
  onUnlock,
}: SecurityLockScreenProps) {
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  return (
    <div className="security-lock-screen">
      <div className="security-lock-card">
        <h1 className="security-lock-title">Locked</h1>
        <p className="security-lock-subtitle">
          Enter your password to unlock notes. Panic password wipes local data and creates 3 dummy
          notes.
        </p>
        <label className="security-lock-input-wrap">
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(event) => {
              setPassword(event.target.value);
              setLocalError(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") {
                return;
              }
              event.preventDefault();
              if (!password.trim()) {
                setLocalError("Password is required.");
                return;
              }
              void onUnlock(password);
            }}
            placeholder="Password"
            disabled={busy}
          />
        </label>
        <button
          type="button"
          className="security-lock-btn"
          disabled={busy}
          onClick={() => {
            if (!password.trim()) {
              setLocalError("Password is required.");
              return;
            }
            void onUnlock(password);
          }}
        >
          {busy ? "Unlocking..." : "Unlock"}
        </button>
        {localError ? <p className="security-lock-error">{localError}</p> : null}
        {!localError && error ? <p className="security-lock-error">{error}</p> : null}
      </div>
    </div>
  );
}
