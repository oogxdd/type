import { Trash2 } from "lucide-react";

import {
  selectActiveProfileId,
  selectSyncSettings,
  updateSyncSettings,
  useProfilesStore,
} from "@/state/profiles-store";
import type { NoteFileNameFormat } from "@typenotes/shared/types";
import { Button } from "@/components/ui/button";
import {
  SettingsCard,
  SettingsField,
  SettingsSection,
  SettingsSelect,
} from "./settings-ui";

const noteFileNameOptions: Array<{ value: NoteFileNameFormat; label: string; hint: string }> = [
  {
    value: "utc_timestamp_slug",
    label: "UTC timestamp + slug (current)",
    hint: "YYYY-MM-DDTHH-mm-ssZ-<slug>.md",
  },
  {
    value: "uuid_v7",
    label: "UUID v7 only",
    hint: "<uuidv7>.md",
  },
  {
    value: "uuid_v7_prefix_slug",
    label: "UUID v7 prefix + slug",
    hint: "<uuidv7-prefix>-<slug>.md",
  },
];

export function SettingsGeneralSection({ onOpenTrash }: { onOpenTrash: () => void }) {
  const activeProfileId = useProfilesStore(selectActiveProfileId);
  const profilesBusy = useProfilesStore((state) => state.busy);
  const syncSettings = useProfilesStore(selectSyncSettings);

  return (
    <SettingsSection title="General">
      <SettingsCard title="Note file names">
        <SettingsField label="Format for new note files">
          <SettingsSelect
            value={syncSettings.noteFileNameFormat}
            onChange={(event) =>
              updateSyncSettings({
                noteFileNameFormat: event.target.value as NoteFileNameFormat,
              })
            }
            disabled={!activeProfileId || profilesBusy}
          >
            {noteFileNameOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SettingsSelect>
        </SettingsField>
        <p className="text-xs text-muted-foreground">
          {noteFileNameOptions.find((option) => option.value === syncSettings.noteFileNameFormat)
            ?.hint ?? "YYYY-MM-DDTHH-mm-ssZ-<slug>.md"}
        </p>
      </SettingsCard>

      <SettingsCard
        title="Trash"
        description="View archived notes and restore or permanently delete them."
      >
        <Button type="button" variant="outline" size="sm" onClick={onOpenTrash}>
          <Trash2 aria-hidden="true" />
          Open Trash
        </Button>
      </SettingsCard>
    </SettingsSection>
  );
}
