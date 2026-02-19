import type { SettingsSectionId } from "../../components/SettingsPanel";
import { useState } from "react";
import { MobileGeneralSection } from "./settings/MobileGeneralSection";
import { MobileAppearanceSection } from "./settings/MobileAppearanceSection";
import { MobileSyncSection } from "./settings/MobileSyncSection";
import { MobileRecordingsSection } from "./settings/MobileRecordingsSection";

type SyncSubSectionId = "actions" | "credentials";

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
  const [syncSubSection, setSyncSubSection] = useState<SyncSubSectionId>("actions");

  const activeSubSections =
    activeSection === "sync"
      ? [
          { id: "actions" as const, label: "Actions" },
          { id: "credentials" as const, label: "Credentials" },
        ]
      : [];

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

        {activeSubSections.length > 0 ? (
          <div className="mobile-settings-subsections" role="tablist" aria-label="Settings subsection">
            {activeSubSections.map((section) => (
              <button
                key={section.id}
                type="button"
                role="tab"
                className={`mobile-settings-subsection-btn${syncSubSection === section.id ? " active" : ""}`}
                onClick={() => setSyncSubSection(section.id)}
                aria-selected={syncSubSection === section.id}
              >
                {section.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mobile-settings-scroll mobile-settings-native">
        {activeSection === "general" ? <MobileGeneralSection /> : null}
        {activeSection === "appearance" ? <MobileAppearanceSection /> : null}
        {activeSection === "sync" ? <MobileSyncSection view={syncSubSection} /> : null}
        {activeSection === "recordings" ? <MobileRecordingsSection /> : null}
      </div>
    </div>
  );
}
