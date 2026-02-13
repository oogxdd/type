import type { ReactNode } from "react";

type MobileNavBarProps = {
  title: string;
  leftAction?: {
    label: string;
    icon: ReactNode;
    onPress: () => void;
  };
  rightAction?: {
    label: string;
    icon: ReactNode;
    onPress: () => void;
  };
};

export function MobileNavBar({ title, leftAction, rightAction }: MobileNavBarProps) {
  return (
    <header className="mobile-nav" role="banner">
      <div className="mobile-nav-side">
        {leftAction ? (
          <button
            type="button"
            className="mobile-nav-btn"
            onClick={leftAction.onPress}
            aria-label={leftAction.label}
            title={leftAction.label}
          >
            <span className="mobile-nav-btn-icon" aria-hidden>
              {leftAction.icon}
            </span>
          </button>
        ) : (
          <span className="mobile-nav-btn-spacer" aria-hidden />
        )}
      </div>
      <h1 className="mobile-nav-title">{title}</h1>
      <div className="mobile-nav-side end">
        {rightAction ? (
          <button
            type="button"
            className="mobile-nav-btn"
            onClick={rightAction.onPress}
            aria-label={rightAction.label}
            title={rightAction.label}
          >
            <span className="mobile-nav-btn-icon" aria-hidden>
              {rightAction.icon}
            </span>
          </button>
        ) : (
          <span className="mobile-nav-btn-spacer" aria-hidden />
        )}
      </div>
    </header>
  );
}
