import type { SettingsSectionId } from "../../components/SettingsPanel";
import { MobileGeneralSection } from "./settings/MobileGeneralSection";
import { MobileAppearanceSection } from "./settings/MobileAppearanceSection";
import { MobileRecordingsSection } from "./settings/MobileRecordingsSection";

type MobileSettingsScreenProps = {
  activeSection: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  sections: Array<{ id: SettingsSectionId; label: string }>;
};

export function MobileSettingsScreen({
  activeSection,
  onSectionChange,
  sections,
}: MobileSettingsScreenProps) {
  return (
    <div className="mobile-settings-screen">
      <div className="mobile-settings-tabs-stack">
        <div className="mobile-settings-sections" role="tablist" aria-label="Settings sections">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              role="tab"
              className={`mobile-settings-section-btn${activeSection === section.id ? " active" : ""}`}
              onClick={() => onSectionChange(section.id)}
              aria-selected={activeSection === section.id}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mobile-settings-scroll mobile-settings-native">
        {activeSection === "general" ? <MobileGeneralSection /> : null}
        {activeSection === "appearance" ? <MobileAppearanceSection /> : null}
        {activeSection === "recordings" ? <MobileRecordingsSection /> : null}
      </div>
    </div>
  );
}
