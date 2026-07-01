import type { ReactNode } from "react";

type MobileNavAction = {
  label: string;
  icon: ReactNode;
  onPress: () => void;
};

type MobileNavBarProps = {
  title: string;
  leftAction?: MobileNavAction;
  rightActions?: MobileNavAction[];
};

export function MobileNavBar({ title, leftAction, rightActions }: MobileNavBarProps) {
  const actions = rightActions?.slice(0, 2) ?? [];

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
        {actions.length > 0 ? (
          actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="mobile-nav-btn"
              onClick={action.onPress}
              aria-label={action.label}
              title={action.label}
            >
              <span className="mobile-nav-btn-icon" aria-hidden>
                {action.icon}
              </span>
            </button>
          ))
        ) : (
          <span className="mobile-nav-btn-spacer" aria-hidden />
        )}
      </div>
    </header>
  );
}
