import { useState } from "react";
import { getOtaAutoCheckEnabled, setOtaAutoCheckEnabled } from "../../utils/storage";

export function SettingsUpdatesSection() {
  const [otaAutoCheckEnabled, setLocalOtaAutoCheckEnabled] = useState(() => getOtaAutoCheckEnabled());

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Updates</h2>
      </div>

      <div className="space-y-4">
        <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
          <h3 className="text-sm font-semibold text-foreground">OTA updates (iOS)</h3>
          <div className="grid gap-2 text-sm">
            <span className="text-sm font-medium text-foreground">Update checks on launch</span>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={otaAutoCheckEnabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setLocalOtaAutoCheckEnabled(enabled);
                  setOtaAutoCheckEnabled(enabled);
                }}
              />
              <span>Check manifest.json at startup</span>
            </label>
            <span className="text-xs text-muted-foreground">
              Disable to always start bundled assets and skip OTA network checks.
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
