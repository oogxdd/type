import { useShallow } from "zustand/react/shallow";

import { useAppearance } from "@/app/state/appearance-store";
import type { NotesListMode, ThemeMode } from "@/shared/types";
import { Checkbox } from "@/shared/ui/checkbox";

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
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Appearance</h2>
        <p className="text-sm text-muted-foreground">Theme and navigation layout.</p>
      </div>

      <div className="space-y-4">
        <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
          <h3 className="text-sm font-semibold text-foreground">Theme</h3>
          <label className="grid gap-2 text-sm">
            <span className="text-sm font-medium text-foreground">Theme mode</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring/60"
              value={theme}
              onChange={(event) => setTheme(event.target.value as ThemeMode)}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
        </section>

        <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
          <h3 className="text-sm font-semibold text-foreground">Notes list</h3>
          <label className="grid gap-2 text-sm">
            <span className="text-sm font-medium text-foreground">Display mode</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring/60"
              value={notesListMode}
              onChange={(event) =>
                setNotesListMode(event.target.value as NotesListMode)
              }
            >
              <option value="separate">Separate notes panel</option>
              <option value="nested">Inside folders navigation</option>
            </select>
            <span className="text-xs text-muted-foreground">Desktop only.</span>
          </label>

          <label className="flex items-start gap-3 rounded-md border border-border/60 bg-background/50 p-3 text-sm">
            <Checkbox
              checked={hideArchivedFeedNotes}
              onCheckedChange={(checked) =>
                setHideArchivedFeedNotes(Boolean(checked))
              }
              className="mt-0.5"
            />
            <span className="grid gap-1">
              <span className="font-medium text-foreground">Hide archived feed notes</span>
              <span className="text-xs text-muted-foreground">
                Archived notes stay in Feed, but they are hidden from the main list.
              </span>
            </span>
          </label>
        </section>
      </div>
    </div>
  );
}
