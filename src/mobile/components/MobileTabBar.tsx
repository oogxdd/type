import type { ReactNode } from "react";

type MobileTabBarItem = {
  id: string;
  label: string;
  icon: ReactNode;
};

type MobileTabBarProps = {
  items: MobileTabBarItem[];
  activeId: string;
  onSelect: (id: string) => void;
};

export function MobileTabBar({ items, activeId, onSelect }: MobileTabBarProps) {
  return (
    <nav className="mobile-tabbar" aria-label="Navigation tabs">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`mobile-tabbar-item${activeId === item.id ? " active" : ""}`}
          onClick={() => onSelect(item.id)}
          aria-current={activeId === item.id ? "page" : undefined}
        >
          <span className="mobile-tabbar-icon" aria-hidden>
            {item.icon}
          </span>
          <span className="mobile-tabbar-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
