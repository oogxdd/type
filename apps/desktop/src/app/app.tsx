import "./app.css";
import "@/components/navigation/tree.css";

import { AppShell } from "@/components/shell/app-shell";
import { ErrorBoundary } from "./error-boundary";
import { AppReadinessGate, AppSecurityGate } from "./readiness";

function App() {
  return (
    <ErrorBoundary>
      <AppSecurityGate>
        <AppReadinessGate>
          <AppShell />
        </AppReadinessGate>
      </AppSecurityGate>
    </ErrorBoundary>
  );
}

export default App;
