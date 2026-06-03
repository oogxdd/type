import { useProfiles } from "@/contexts/profiles-context";
import type { NoteFileNameFormat } from "@/types";

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

export function SettingsGeneralSection() {
  const { activeProfileId, profilesBusy, syncSettings, updateSyncSettings } = useProfiles();

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">General</h2>
      </div>

      <div className="space-y-4">
        <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
          <h3 className="text-sm font-semibold text-foreground">Note file names</h3>
          <label className="grid gap-2 text-sm">
            <span className="text-sm font-medium text-foreground">Format for new note files</span>
            <select
              className="h-9 min-w-[220px] flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring/60"
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
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            {noteFileNameOptions.find((option) => option.value === syncSettings.noteFileNameFormat)
              ?.hint ?? "YYYY-MM-DDTHH-mm-ssZ-<slug>.md"}
          </p>
        </section>
      </div>
    </div>
  );
}
