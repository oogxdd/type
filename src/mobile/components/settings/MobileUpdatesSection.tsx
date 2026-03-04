import { useState } from "react";
import { getOtaAutoCheckEnabled, setOtaAutoCheckEnabled } from "../../../utils/storage";
import { ChoiceRow, Group } from "./SettingsHelpers";

export function MobileUpdatesSection() {
  const [otaAutoCheckEnabled, setLocalOtaAutoCheckEnabled] = useState(() => getOtaAutoCheckEnabled());

  return (
    <Group title="OTA updates (iOS)">
      <ChoiceRow
        label="Check for updates on launch"
        subtitle="Fetches manifest.json before startup."
        selected={otaAutoCheckEnabled}
        onClick={() => {
          setLocalOtaAutoCheckEnabled(true);
          setOtaAutoCheckEnabled(true);
        }}
      />
      <ChoiceRow
        label="Always use bundled version"
        subtitle="Skips OTA network check for faster startup."
        selected={!otaAutoCheckEnabled}
        onClick={() => {
          setLocalOtaAutoCheckEnabled(false);
          setOtaAutoCheckEnabled(false);
        }}
      />
    </Group>
  );
}
