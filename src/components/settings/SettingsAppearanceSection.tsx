import type { ThemeMode } from "../SettingsPanel";
import { useTheme } from "../../contexts/ThemeContext";

export function SettingsAppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <>
      <h2 className="settings-detail-title">Appearance</h2>
      <p className="settings-detail-text">Visual style options.</p>
      <label className="settings-control">
        <span>Theme</span>
        <select
          value={theme}
          onChange={(event) => setTheme(event.target.value as ThemeMode)}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
    </>
  );
}
