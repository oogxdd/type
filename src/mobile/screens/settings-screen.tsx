import type { SettingsSectionId } from "@/features/settings/lib/sections";
import { MobileSettingsScreen } from "@/features/settings/components/mobile/settings-screen";
import { MOBILE_SETTINGS_SECTIONS } from "@/constants";

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
