import "./app.css";
import "@/features/notes/navigation/ui/tree.css";

import { AppShell } from "./app-shell";
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
