import { useTheme } from "../../../contexts/ThemeContext";
import { Group, ChoiceRow } from "./SettingsHelpers";

export function MobileAppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
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
  );
}
