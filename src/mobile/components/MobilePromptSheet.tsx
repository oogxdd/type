import { useEffect, useMemo, useState } from "react";

type MobilePromptSheetProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  initialValue: string;
  placeholder?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (value: string) => Promise<void> | void;
};

export function MobilePromptSheet({
  open,
  title,
  subtitle,
  initialValue,
  placeholder,
  confirmLabel = "Save",
  onClose,
  onConfirm,
}: MobilePromptSheetProps) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const trimmed = useMemo(() => value.trim(), [value]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setBusy(false);
    setValue(initialValue);
  }, [initialValue, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="mobile-sheet-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        className="mobile-sheet-backdrop"
        aria-label="Close rename form"
        onClick={() => {
          if (!busy) {
            onClose();
          }
        }}
      />
      <div className="mobile-sheet">
        <div className="mobile-sheet-header">
          <h3 className="mobile-sheet-title">{title}</h3>
          {subtitle ? <p className="mobile-sheet-subtitle">{subtitle}</p> : null}
        </div>

        <label className="mobile-sheet-input-wrap">
          <span className="mobile-sheet-input-label">Name</span>
          <input
            type="text"
            className="mobile-sheet-input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            autoFocus
          />
        </label>

        <div className="mobile-sheet-actions">
          <button
            type="button"
            className="mobile-sheet-action"
            onClick={() => {
              if (!busy) {
                onClose();
              }
            }}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="mobile-sheet-action"
            disabled={busy || trimmed.length === 0}
            onClick={() => {
              if (busy || trimmed.length === 0) {
                return;
              }
              void (async () => {
                setBusy(true);
                try {
                  await onConfirm(trimmed);
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {busy ? "Saving..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
