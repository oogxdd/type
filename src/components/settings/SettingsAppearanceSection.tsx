import { useTheme } from "../../contexts/ThemeContext";
import type { NotesListMode, ThemeMode } from "../SettingsPanel";

export function SettingsAppearanceSection() {
  const { theme, setTheme, notesListMode, setNotesListMode } = useTheme();

  return (
    <>
      <div className="settings-detail-hero">
        <h2 className="settings-detail-title">Appearance</h2>
        <p className="settings-detail-text">Theme and navigation layout.</p>
      </div>

      <div className="settings-section-stack">
        <section className="settings-group">
          <h3 className="settings-group-title">Theme</h3>
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
        </section>

        <section className="settings-group">
          <h3 className="settings-group-title">Notes list</h3>
          <label className="settings-control">
            <span>Display mode</span>
            <select
              value={notesListMode}
              onChange={(event) =>
                setNotesListMode(event.target.value as NotesListMode)
              }
            >
              <option value="separate">Separate notes panel</option>
                <option value="nested">Inside folders navigation</option>
              </select>
            <span className="settings-inline-help">Desktop only.</span>
          </label>
        </section>
      </div>
    </>
  );
}
