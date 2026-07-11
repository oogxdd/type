import { useShallow } from "zustand/react/shallow";

import { useAppearance } from "@/state/appearance-store";
import type { NotesListMode, ThemeMode } from "@typenotes/shared/types";
import { Checkbox } from "@/components/ui/checkbox";
import {
  SettingsCard,
  SettingsField,
  SettingsSection,
  SettingsSelect,
} from "./settings-ui";

export function SettingsAppearanceSection() {
  const {
    theme,
    setTheme,
    notesListMode,
    setNotesListMode,
    hideArchivedFeedNotes,
    setHideArchivedFeedNotes,
  } = useAppearance(
    useShallow((state) => ({
      theme: state.theme,
      setTheme: state.setTheme,
      notesListMode: state.notesListMode,
      setNotesListMode: state.setNotesListMode,
      hideArchivedFeedNotes: state.hideArchivedFeedNotes,
      setHideArchivedFeedNotes: state.setHideArchivedFeedNotes,
    }))
  );

  return (
    <SettingsSection title="Appearance" description="Theme and navigation layout.">
      <SettingsCard title="Theme">
        <SettingsField label="Theme mode">
          <SettingsSelect
            value={theme}
            onChange={(event) => setTheme(event.target.value as ThemeMode)}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </SettingsSelect>
        </SettingsField>
      </SettingsCard>

      <SettingsCard title="Notes list">
        <SettingsField label="Display mode" hint="Desktop only.">
          <SettingsSelect
            value={notesListMode}
            onChange={(event) =>
              setNotesListMode(event.target.value as NotesListMode)
            }
          >
            <option value="separate">Separate notes panel</option>
            <option value="nested">Inside folders navigation</option>
          </SettingsSelect>
        </SettingsField>

        <label className="flex items-start gap-3 rounded-md border border-border/50 bg-background/40 p-3 text-sm">
          <Checkbox
            checked={hideArchivedFeedNotes}
            onCheckedChange={(checked) =>
              setHideArchivedFeedNotes(Boolean(checked))
            }
            className="mt-0.5"
          />
          <span className="grid gap-1">
            <span className="font-medium text-foreground">Hide archived feed notes</span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              Archived notes stay in Feed, but they are hidden from the main list.
            </span>
          </span>
        </label>
      </SettingsCard>
    </SettingsSection>
  );
}
