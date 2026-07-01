import { useEffect } from "react";
import type { MobileActionSheetState } from "../navigation";

type MobileActionSheetProps = {
  state: MobileActionSheetState | null;
  onClose: () => void;
  onSelect: (actionId: string) => void;
};

export function MobileActionSheet({ state, onClose, onSelect }: MobileActionSheetProps) {
  useEffect(() => {
    if (!state?.open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, state?.open]);

  if (!state || !state.open) {
    return null;
  }

  return (
    <div className="mobile-sheet-overlay" role="dialog" aria-modal="true" aria-label={state.title}>
      <button
        type="button"
        className="mobile-sheet-backdrop"
        aria-label="Close actions"
        onClick={onClose}
      />
      <div className="mobile-sheet">
        <div className="mobile-sheet-header">
          <h3 className="mobile-sheet-title">{state.title}</h3>
          {state.subtitle ? <p className="mobile-sheet-subtitle">{state.subtitle}</p> : null}
        </div>
        <div className="mobile-sheet-actions">
          {state.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={`mobile-sheet-action${action.destructive ? " destructive" : ""}`}
              disabled={action.disabled}
              onClick={() => onSelect(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
        <button type="button" className="mobile-sheet-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
