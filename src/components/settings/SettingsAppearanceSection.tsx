import { useTheme } from "../../contexts/ThemeContext";
import type { NotesListMode, ThemeMode } from "../SettingsPanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Separator } from "../ui/separator";

export function SettingsAppearanceSection() {
  const { theme, setTheme, notesListMode, setNotesListMode } = useTheme();

  return (
    <>
      <h2 className="settings-detail-title">Appearance</h2>
      <p className="settings-detail-text">Visual style and desktop layout behavior.</p>

      <div className="settings-section-stack">
        <Card className="settings-card-block">
          <CardHeader className="settings-card-block-header">
            <CardTitle className="settings-card-block-title">Theme</CardTitle>
            <CardDescription className="settings-card-block-description">
              Select the app color scheme.
            </CardDescription>
          </CardHeader>
          <CardContent className="settings-card-block-content">
            <label className="settings-control">
              <span>Theme mode</span>
              <select
                value={theme}
                onChange={(event) => setTheme(event.target.value as ThemeMode)}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
            <Separator className="settings-card-separator" />
            <label className="settings-control">
              <span>Notes list location</span>
              <select
                value={notesListMode}
                onChange={(event) =>
                  setNotesListMode(event.target.value as NotesListMode)
                }
              >
                <option value="separate">Separate notes panel</option>
                <option value="nested">Inside folders navigation</option>
              </select>
              <span className="settings-inline-help">
                Desktop only. Changes where notes are shown while browsing folders.
              </span>
            </label>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
