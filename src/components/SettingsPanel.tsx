import { Button } from "./ui/button";

export type ThemeMode = "light" | "dark";
export type NotesListMode = "separate" | "nested";

type SettingsSectionId =
  | "general"
  | "appearance"
  | "editor"
  | "sync"
  | "security"
  | "privacy"
  | "about";

type SettingsSection = {
  id: SettingsSectionId;
  title: string;
  description: string;
};

const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "general", title: "General", description: "Basic app behavior and defaults." },
  { id: "appearance", title: "Appearance", description: "Typography, spacing, and theme accents." },
  { id: "editor", title: "Editor", description: "Editing, autosave, and preview behavior." },
  { id: "sync", title: "Sync", description: "Cloud sync, refresh policy, and conflict rules." },
  { id: "security", title: "Security", description: "App lock and emergency wipe options (dummy)." },
  { id: "privacy", title: "Privacy", description: "Data collection and local-only controls." },
  { id: "about", title: "About", description: "Version, diagnostics, and support links." },
];

function SettingsRow({
  section,
  isSelected,
  onSelect,
}: {
  section: SettingsSection;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      className={`item-row settings-row transition-colors${isSelected ? " selected" : ""}`}
      variant="ghost"
      size="sm"
      onClick={onSelect}
    >
      <div className="settings-row-main">
        <div className="settings-row-title">{section.title}</div>
        <div className="settings-row-subline">{section.description}</div>
      </div>
    </Button>
  );
}

function SettingsDetail({
  sectionId,
  theme,
  onThemeChange,
  notesListMode,
  onNotesListModeChange,
}: {
  sectionId: SettingsSectionId;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  notesListMode: NotesListMode;
  onNotesListModeChange: (mode: NotesListMode) => void;
}) {
  if (sectionId === "general") {
    return (
      <>
        <h2 className="settings-detail-title">General</h2>
        <p className="settings-detail-text">Default behavior and opening workflow.</p>
        <label className="settings-control">
          <span>Start in folder</span>
          <select defaultValue="last">
            <option value="last">Last opened</option>
            <option value="inbox">Inbox</option>
            <option value="none">No auto-open</option>
          </select>
        </label>
        <label className="settings-control">
          <span>Notes list location</span>
          <select
            value={notesListMode}
            onChange={(event) =>
              onNotesListModeChange(event.target.value as NotesListMode)
            }
          >
            <option value="separate">Separate notes panel</option>
            <option value="nested">Inside folders navigation</option>
          </select>
        </label>
        <label className="settings-control settings-toggle">
          <input type="checkbox" defaultChecked />
          <span>Auto-focus first note in selected folder</span>
        </label>
      </>
    );
  }
  if (sectionId === "appearance") {
    return (
      <>
        <h2 className="settings-detail-title">Appearance</h2>
        <p className="settings-detail-text">Visual style options (dummy).</p>
        <label className="settings-control">
          <span>Theme</span>
          <select
            value={theme}
            onChange={(event) => onThemeChange(event.target.value as ThemeMode)}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <label className="settings-control">
          <span>UI density</span>
          <select defaultValue="comfortable">
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
            <option value="spacious">Spacious</option>
          </select>
        </label>
        <label className="settings-control">
          <span>Accent intensity</span>
          <input type="range" min="0" max="100" defaultValue="45" />
        </label>
        <label className="settings-control settings-toggle">
          <input type="checkbox" defaultChecked />
          <span>Show subtle separators in lists</span>
        </label>
      </>
    );
  }
  if (sectionId === "editor") {
    return (
      <>
        <h2 className="settings-detail-title">Editor</h2>
        <p className="settings-detail-text">Editing and autosave behavior.</p>
        <label className="settings-control">
          <span>Autosave interval</span>
          <select defaultValue="400">
            <option value="250">250 ms</option>
            <option value="400">400 ms</option>
            <option value="1000">1 sec</option>
          </select>
        </label>
        <label className="settings-control settings-toggle">
          <input type="checkbox" defaultChecked />
          <span>Strip markdown in list previews</span>
        </label>
        <label className="settings-control settings-toggle">
          <input type="checkbox" />
          <span>Always open in markdown mode</span>
        </label>
      </>
    );
  }
  if (sectionId === "sync") {
    return (
      <>
        <h2 className="settings-detail-title">Sync</h2>
        <p className="settings-detail-text">Connection and refresh policy.</p>
        <label className="settings-control">
          <span>Sync provider</span>
          <select defaultValue="icloud">
            <option value="icloud">iCloud</option>
            <option value="local">Local filesystem</option>
            <option value="none">Disabled</option>
          </select>
        </label>
        <label className="settings-control settings-toggle">
          <input type="checkbox" defaultChecked />
          <span>Background refresh every 5 minutes</span>
        </label>
      </>
    );
  }
  if (sectionId === "security") {
    return (
      <>
        <h2 className="settings-detail-title">Security</h2>
        <p className="settings-detail-text">
          Sample configuration only. Real lock and wipe logic will be implemented later.
        </p>

        <div className="settings-subsection">
          <h3 className="settings-subtitle">App lock</h3>
          <label className="settings-control settings-toggle">
            <input type="checkbox" defaultChecked />
            <span>Enable PIN/password lock</span>
          </label>
          <label className="settings-control">
            <span>Lock method</span>
            <select defaultValue="pin">
              <option value="pin">PIN (4-8 digits)</option>
              <option value="password">Password</option>
            </select>
          </label>
          <label className="settings-control">
            <span>PIN / password</span>
            <input type="password" placeholder="Enter value" />
          </label>
          <label className="settings-control">
            <span>Confirm PIN / password</span>
            <input type="password" placeholder="Repeat value" />
          </label>
          <fieldset className="settings-radio-group">
            <legend>Auto-lock trigger</legend>
            <label className="settings-radio-row">
              <input type="radio" name="auto-lock-trigger" defaultChecked />
              <span>After inactivity interval</span>
            </label>
            <label className="settings-radio-row">
              <input type="radio" name="auto-lock-trigger" />
              <span>Immediately when app loses focus</span>
            </label>
            <label className="settings-radio-row">
              <input type="radio" name="auto-lock-trigger" />
              <span>Only when I press Lock now</span>
            </label>
          </fieldset>
          <label className="settings-control">
            <span>Inactivity interval</span>
            <select defaultValue="5m">
              <option value="1m">1 minute</option>
              <option value="5m">5 minutes</option>
              <option value="15m">15 minutes</option>
              <option value="30m">30 minutes</option>
            </select>
          </label>
          <div className="settings-action-row">
            <Button variant="outline" size="sm" type="button">
              Lock now
            </Button>
          </div>
        </div>

        <div className="settings-subsection settings-warning-zone">
          <h3 className="settings-subtitle">Panic wipe code</h3>
          <p className="settings-warning-text">
            Entering this code on unlock will erase all local data. This screen is
            visual-only for now.
          </p>
          <label className="settings-control settings-toggle">
            <input type="checkbox" />
            <span>Enable panic wipe code</span>
          </label>
          <label className="settings-control">
            <span>Wipe PIN / password</span>
            <input type="password" placeholder="Enter emergency code" />
          </label>
          <label className="settings-control">
            <span>Confirm wipe PIN / password</span>
            <input type="password" placeholder="Repeat emergency code" />
          </label>
          <div className="settings-action-row">
            <Button variant="destructive" size="sm" type="button">
              Test wipe flow (dummy)
            </Button>
          </div>
        </div>
      </>
    );
  }
  if (sectionId === "privacy") {
    return (
      <>
        <h2 className="settings-detail-title">Privacy</h2>
        <p className="settings-detail-text">Telemetry and local diagnostics.</p>
        <label className="settings-control settings-toggle">
          <input type="checkbox" />
          <span>Send anonymous crash reports</span>
        </label>
        <label className="settings-control settings-toggle">
          <input type="checkbox" defaultChecked />
          <span>Keep all metadata local-only</span>
        </label>
      </>
    );
  }
  return (
    <>
      <h2 className="settings-detail-title">About</h2>
      <p className="settings-detail-text">Dummy system info for layout preview.</p>
      <div className="settings-info-grid">
        <div className="settings-info-row">
          <span>Version</span>
          <code>0.1.0-design</code>
        </div>
        <div className="settings-info-row">
          <span>Storage root</span>
          <code>~/notes</code>
        </div>
        <div className="settings-info-row">
          <span>Renderer</span>
          <code>Tauri + React</code>
        </div>
      </div>
      <div className="settings-action-row">
        <Button variant="outline" size="sm" type="button">
          Check updates
        </Button>
        <Button variant="secondary" size="sm" type="button">
          Reset demo values
        </Button>
      </div>
    </>
  );
}

export function SettingsMiddlePane({
  activeSection,
  onSectionChange,
  middlePaneRef,
  onPaneClick,
}: {
  activeSection: string;
  onSectionChange: (id: SettingsSectionId) => void;
  middlePaneRef: React.RefObject<HTMLDivElement | null>;
  onPaneClick: () => void;
}) {
  return (
    <div className="pane settings-sections-pane min-w-0">
      <div className="pane-drag-region" data-tauri-drag-region aria-hidden />
      <div
        className="pane-body settings-sections-body"
        ref={middlePaneRef}
        tabIndex={0}
        onClick={onPaneClick}
      >
        {SETTINGS_SECTIONS.map((section) => (
          <SettingsRow
            key={section.id}
            section={section}
            isSelected={activeSection === section.id}
            onSelect={() => onSectionChange(section.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function SettingsDetailPane({
  activeSection,
  theme,
  onThemeChange,
  notesListMode,
  onNotesListModeChange,
  rightPaneRef,
  onPaneClick,
}: {
  activeSection: string;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  notesListMode: NotesListMode;
  onNotesListModeChange: (mode: NotesListMode) => void;
  rightPaneRef: React.RefObject<HTMLDivElement | null>;
  onPaneClick: () => void;
}) {
  return (
    <div className="pane settings-detail-pane min-w-0">
      <div
        className="pane-body settings-detail-body"
        ref={rightPaneRef}
        tabIndex={0}
        onClick={onPaneClick}
      >
        <SettingsDetail
          sectionId={activeSection as SettingsSectionId}
          theme={theme}
          onThemeChange={onThemeChange}
          notesListMode={notesListMode}
          onNotesListModeChange={onNotesListModeChange}
        />
      </div>
    </div>
  );
}
