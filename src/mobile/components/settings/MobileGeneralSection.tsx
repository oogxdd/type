import { useProfiles } from "../../../contexts/ProfilesContext";
import type { NoteFileNameFormat } from "../../../types";
import { ChoiceRow, Group } from "./SettingsHelpers";

const noteFileNameOptions: Array<{
  value: NoteFileNameFormat;
  label: string;
  subtitle: string;
}> = [
  {
    value: "utc_timestamp_slug",
    label: "UTC timestamp + slug (current)",
    subtitle: "YYYY-MM-DDTHH-mm-ssZ-<slug>.md",
  },
  {
    value: "uuid_v7",
    label: "UUID v7 only",
    subtitle: "<uuidv7>.md",
  },
  {
    value: "uuid_v7_prefix_slug",
    label: "UUID v7 prefix + slug",
    subtitle: "<uuidv7-prefix>-<slug>.md",
  },
];

export function MobileGeneralSection() {
  const { syncSettings, updateSyncSettings } = useProfiles();

  return (
    <Group title="Note file names">
      {noteFileNameOptions.map((option) => (
        <ChoiceRow
          key={option.value}
          label={option.label}
          subtitle={option.subtitle}
          selected={syncSettings.noteFileNameFormat === option.value}
          onClick={() => updateSyncSettings({ noteFileNameFormat: option.value })}
        />
      ))}
    </Group>
  );
}
