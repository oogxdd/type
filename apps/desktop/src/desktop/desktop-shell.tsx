import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/shared/ui/resizable";

type DesktopShellProps = {
  theme: "light" | "dark";
  appStyle: CSSProperties;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  showMiddlePane: boolean;
  twoPaneLayout: Record<string, number>;
  setTwoPaneLayout: Dispatch<SetStateAction<Record<string, number>>>;
  threePaneLayout: Record<string, number>;
  setThreePaneLayout: Dispatch<SetStateAction<Record<string, number>>>;
  leftPane: ReactNode;
  middlePane: ReactNode;
  rightPane: ReactNode;
};

export function DesktopShell({
  theme,
  appStyle,
  sidebarCollapsed,
  onToggleSidebar,
  showMiddlePane,
  twoPaneLayout,
  setTwoPaneLayout,
  threePaneLayout,
  setThreePaneLayout,
  leftPane,
  middlePane,
  rightPane,
}: DesktopShellProps) {
  const rightPaneWithSidebarToggle = (
    <div className="desktop-right-pane-slot">
      {rightPane}
      <button
        type="button"
        className="sidebar-toggle-btn"
        aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        aria-pressed={!sidebarCollapsed}
        title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        onClick={onToggleSidebar}
      >
        <svg viewBox="0 0 16 16" aria-hidden>
          <rect
            x="1.25"
            y="1.75"
            width="13.5"
            height="12.5"
            rx="3.25"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
          />
          <path
            d="M5.8 2.9v10.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
          />
        </svg>
      </button>
    </div>
  );

  return (
    <div className={`app theme-${theme}${sidebarCollapsed ? " sidebar-collapsed" : ""}`} style={appStyle}>
      {sidebarCollapsed ? (
        <div className="app-single-pane">{rightPaneWithSidebarToggle}</div>
      ) : !showMiddlePane ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="app-panels"
          defaultLayout={twoPaneLayout}
          onLayoutChanged={(layout) => setTwoPaneLayout(layout)}
        >
          <ResizablePanel
            id="nav"
            defaultSize="29%"
            minSize="18%"
            maxSize="44%"
            className="min-w-0 h-full min-h-0"
          >
            {leftPane}
          </ResizablePanel>
          <ResizableHandle className="app-resize-handle" />
          <ResizablePanel
            id="content"
            defaultSize="71%"
            minSize="35%"
            className="min-w-0 h-full min-h-0"
          >
            {rightPaneWithSidebarToggle}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="app-panels"
          defaultLayout={threePaneLayout}
          onLayoutChanged={(layout) => setThreePaneLayout(layout)}
        >
          <ResizablePanel
            id="nav"
            defaultSize="22%"
            minSize="16%"
            maxSize="34%"
            className="min-w-0 h-full min-h-0"
          >
            {leftPane}
          </ResizablePanel>
          <ResizableHandle className="app-resize-handle" />
          <ResizablePanel
            id="middle"
            defaultSize="25%"
            minSize="18%"
            maxSize="40%"
            className="min-w-0 h-full min-h-0"
          >
            {middlePane}
          </ResizablePanel>
          <ResizableHandle className="app-resize-handle app-resize-handle-editor" />
          <ResizablePanel
            id="content"
            defaultSize="53%"
            minSize="30%"
            className="min-w-0 h-full min-h-0"
          >
            {rightPaneWithSidebarToggle}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
