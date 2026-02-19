import { useTheme } from "../../../contexts/ThemeContext";
import { Group, ChoiceRow } from "./SettingsHelpers";

export function MobileAppearanceSection() {
  const { theme, setTheme, notesListMode, setNotesListMode } = useTheme();

  return (
    <>
      <Group title="Theme">
        <ChoiceRow
          label="Light"
          selected={theme === "light"}
          onClick={() => setTheme("light")}
        />
        <ChoiceRow
          label="Dark"
          selected={theme === "dark"}
          onClick={() => setTheme("dark")}
        />
      </Group>

      <Group title="Notes list">
        <ChoiceRow
          label="Separate panel"
          selected={notesListMode === "separate"}
          onClick={() => setNotesListMode("separate")}
        />
        <ChoiceRow
          label="Nested in folders"
          selected={notesListMode === "nested"}
          onClick={() => setNotesListMode("nested")}
        />
      </Group>
    </>
  );
}
