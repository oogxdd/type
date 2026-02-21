import { useState } from "react";
import { getOtaAutoCheckEnabled, setOtaAutoCheckEnabled } from "../../utils/storage";

export function SettingsUpdatesSection() {
  const [otaAutoCheckEnabled, setLocalOtaAutoCheckEnabled] = useState(() => getOtaAutoCheckEnabled());

  return (
    <>
      <div className="settings-detail-hero">
        <h2 className="settings-detail-title">Updates</h2>
      </div>

      <div className="settings-section-stack">
        <section className="settings-group">
          <h3 className="settings-group-title">OTA updates (iOS)</h3>
          <div className="settings-control">
            <span>Update checks on launch</span>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={otaAutoCheckEnabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setLocalOtaAutoCheckEnabled(enabled);
                  setOtaAutoCheckEnabled(enabled);
                }}
              />
              <span>Check manifest.json at startup</span>
            </label>
            <span className="settings-inline-help">
              Disable to always start bundled assets and skip OTA network checks.
            </span>
          </div>
        </section>
      </div>
    </>
  );
}
