import { Button } from "./ui/button";
import type { GitSyncStatus } from "../types";

export type ThemeMode = "light" | "dark";
export type NotesListMode = "separate" | "nested";

type SettingsSectionId =
  | "general"
  | "appearance"
  | "sync";

type SettingsSection = {
  id: SettingsSectionId;
  title: string;
  description: string;
};

const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "general", title: "General", description: "Basic app behavior and defaults." },
  { id: "appearance", title: "Appearance", description: "Theme and visual style." },
  { id: "sync", title: "Sync", description: "Cloud sync, refresh policy, and conflict rules." },
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
  gitRemoteUrl,
  onGitRemoteUrlChange,
  gitBranch,
  onGitBranchChange,
  gitUsername,
  onGitUsernameChange,
  gitPassword,
  onGitPasswordChange,
  gitCommitMessage,
  onGitCommitMessageChange,
  gitStatus,
  gitSyncBusy,
  gitSyncError,
  onGitRefresh,
  onGitConnect,
  onGitPull,
  onGitPush,
}: {
  sectionId: SettingsSectionId;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  notesListMode: NotesListMode;
  onNotesListModeChange: (mode: NotesListMode) => void;
  gitRemoteUrl: string;
  onGitRemoteUrlChange: (value: string) => void;
  gitBranch: string;
  onGitBranchChange: (value: string) => void;
  gitUsername: string;
  onGitUsernameChange: (value: string) => void;
  gitPassword: string;
  onGitPasswordChange: (value: string) => void;
  gitCommitMessage: string;
  onGitCommitMessageChange: (value: string) => void;
  gitStatus: GitSyncStatus | null;
  gitSyncBusy: boolean;
  gitSyncError: string | null;
  onGitRefresh: () => void;
  onGitConnect: () => void;
  onGitPull: () => void;
  onGitPush: () => void;
}) {
  if (sectionId === "general") {
    return (
      <>
        <h2 className="settings-detail-title">General</h2>
        <p className="settings-detail-text">Default behavior.</p>
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
      </>
    );
  }
  if (sectionId === "appearance") {
    return (
      <>
        <h2 className="settings-detail-title">Appearance</h2>
        <p className="settings-detail-text">Visual style options.</p>
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
      </>
    );
  }
  if (sectionId === "sync") {
    return (
      <>
        <h2 className="settings-detail-title">Sync</h2>
        <p className="settings-detail-text">
          Git-based sync. Your notes stay local and can be pushed/pulled to a remote repo.
        </p>
        <label className="settings-control">
          <span>Remote repository URL</span>
          <input
            type="text"
            value={gitRemoteUrl}
            onChange={(event) => onGitRemoteUrlChange(event.target.value)}
            placeholder="https://github.com/you/notes.git"
          />
        </label>
        <label className="settings-control">
          <span>Branch</span>
          <input
            type="text"
            value={gitBranch}
            onChange={(event) => onGitBranchChange(event.target.value)}
            placeholder="main"
          />
        </label>
        <label className="settings-control">
          <span>Commit message</span>
          <input
            type="text"
            value={gitCommitMessage}
            onChange={(event) => onGitCommitMessageChange(event.target.value)}
            placeholder="Sync notes"
          />
        </label>
        <label className="settings-control">
          <span>Git username (optional, for HTTPS auth)</span>
          <input
            type="text"
            value={gitUsername}
            onChange={(event) => onGitUsernameChange(event.target.value)}
            placeholder="your-github-username"
          />
        </label>
        <label className="settings-control">
          <span>Git token/password (optional)</span>
          <input
            type="password"
            value={gitPassword}
            onChange={(event) => onGitPasswordChange(event.target.value)}
            placeholder="Personal access token"
          />
        </label>
        <div className="settings-info-grid">
          <div className="settings-info-row">
            <span>Git available</span>
            <code>{gitStatus?.git_available ? "yes" : "no"}</code>
          </div>
          <div className="settings-info-row">
            <span>Repository</span>
            <code>{gitStatus?.repo_initialized ? "initialized" : "not initialized"}</code>
          </div>
          <div className="settings-info-row">
            <span>Current branch</span>
            <code>{gitStatus?.current_branch ?? "-"}</code>
          </div>
          <div className="settings-info-row">
            <span>Remote URL</span>
            <code>{gitStatus?.remote_url ?? "-"}</code>
          </div>
          <div className="settings-info-row">
            <span>Working tree</span>
            <code>{gitStatus?.has_uncommitted_changes ? "changes pending" : "clean"}</code>
          </div>
          <div className="settings-info-row">
            <span>Ahead / behind</span>
            <code>
              {gitStatus ? `${gitStatus.ahead} ahead / ${gitStatus.behind} behind` : "-"}
            </code>
          </div>
          <div className="settings-info-row">
            <span>Notes root</span>
            <code>{gitStatus?.notes_root ?? "-"}</code>
          </div>
        </div>
        {gitSyncError ? (
          <p className="settings-warning-text settings-inline-warning">{gitSyncError}</p>
        ) : null}
        <label className="settings-control">
          <span>Recommended flow</span>
          <span className="settings-inline-help">
            Desktop and iOS point to the same repo and branch. Pull before editing, push after.
          </span>
        </label>
        <div className="settings-action-row">
          <Button variant="outline" size="sm" type="button" onClick={onGitRefresh} disabled={gitSyncBusy}>
            Refresh status
          </Button>
          <Button size="sm" type="button" onClick={onGitConnect} disabled={gitSyncBusy}>
            Connect repo
          </Button>
          <Button variant="secondary" size="sm" type="button" onClick={onGitPull} disabled={gitSyncBusy}>
            Pull
          </Button>
          <Button variant="secondary" size="sm" type="button" onClick={onGitPush} disabled={gitSyncBusy}>
            Push
          </Button>
        </div>
      </>
    );
  }
  return null;
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
  gitRemoteUrl,
  onGitRemoteUrlChange,
  gitBranch,
  onGitBranchChange,
  gitUsername,
  onGitUsernameChange,
  gitPassword,
  onGitPasswordChange,
  gitCommitMessage,
  onGitCommitMessageChange,
  gitStatus,
  gitSyncBusy,
  gitSyncError,
  onGitRefresh,
  onGitConnect,
  onGitPull,
  onGitPush,
  rightPaneRef,
  onPaneClick,
}: {
  activeSection: string;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  notesListMode: NotesListMode;
  onNotesListModeChange: (mode: NotesListMode) => void;
  gitRemoteUrl: string;
  onGitRemoteUrlChange: (value: string) => void;
  gitBranch: string;
  onGitBranchChange: (value: string) => void;
  gitUsername: string;
  onGitUsernameChange: (value: string) => void;
  gitPassword: string;
  onGitPasswordChange: (value: string) => void;
  gitCommitMessage: string;
  onGitCommitMessageChange: (value: string) => void;
  gitStatus: GitSyncStatus | null;
  gitSyncBusy: boolean;
  gitSyncError: string | null;
  onGitRefresh: () => void;
  onGitConnect: () => void;
  onGitPull: () => void;
  onGitPush: () => void;
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
          gitRemoteUrl={gitRemoteUrl}
          onGitRemoteUrlChange={onGitRemoteUrlChange}
          gitBranch={gitBranch}
          onGitBranchChange={onGitBranchChange}
          gitUsername={gitUsername}
          onGitUsernameChange={onGitUsernameChange}
          gitPassword={gitPassword}
          onGitPasswordChange={onGitPasswordChange}
          gitCommitMessage={gitCommitMessage}
          onGitCommitMessageChange={onGitCommitMessageChange}
          gitStatus={gitStatus}
          gitSyncBusy={gitSyncBusy}
          gitSyncError={gitSyncError}
          onGitRefresh={onGitRefresh}
          onGitConnect={onGitConnect}
          onGitPull={onGitPull}
          onGitPush={onGitPush}
        />
      </div>
    </div>
  );
}
