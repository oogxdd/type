import "./app.css";
import "@/components/navigation/tree.css";

import { AppShell } from "@/components/shell/app-shell";
import { ErrorBoundary } from "./error-boundary";
import { AppProviders } from "./providers";

function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <AppShell />
      </AppProviders>
    </ErrorBoundary>
  );
}

export default App;
