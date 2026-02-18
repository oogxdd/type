import type { SettingsSectionId } from "../../components/SettingsPanel";
import { MobileSettingsScreen } from "../components/MobileSettingsScreen";
import { MOBILE_SETTINGS_SECTIONS } from "../../constants";

type PhoneSettingsScreenProps = {
  activeSettingsSection: SettingsSectionId;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
};

export function PhoneSettingsScreen({
  activeSettingsSection,
  onSettingsSectionChange,
}: PhoneSettingsScreenProps) {
  return (
    <MobileSettingsScreen
      activeSection={activeSettingsSection}
      onSectionChange={onSettingsSectionChange}
      sections={MOBILE_SETTINGS_SECTIONS}
    />
  );
}
