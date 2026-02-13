import type { NotesListMode, SettingsSectionId, ThemeMode } from "../../components/SettingsPanel";
import type { GitSyncStatus } from "../../types";

type MobileSettingsScreenProps = {
  activeSection: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  sections: Array<{ id: SettingsSectionId; label: string }>;
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
  lastSuccessfulSyncAt: string | null;
};

const getSyncHint = (error: string | null): string | null => {
  if (!error) {
    return null;
  }
  const lower = error.toLowerCase();
  if (lower.includes("local changes detected")) {
    return "Pull blocked: push your local edits first.";
  }
  if (lower.includes("merge commit")) {
    return "History diverged. Resolve on desktop, push, then pull again on mobile.";
  }
  if (lower.includes("credentials")) {
    return "Authentication failed. Check username and token/password.";
  }
  if (lower.includes("not initialized")) {
    return "Repository is not connected. Run Connect repo first.";
  }
  return "Sync failed. Check network/repository settings and retry.";
};

export function MobileSettingsScreen({
  activeSection,
  onSectionChange,
  sections,
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
  lastSuccessfulSyncAt,
}: MobileSettingsScreenProps) {
  const syncHint = getSyncHint(gitSyncError);
  const canPull = !gitSyncBusy && Boolean(gitStatus?.repo_initialized) && !gitStatus?.has_uncommitted_changes;
  const canPush = !gitSyncBusy && Boolean(gitStatus?.repo_initialized);
  const canConnect = !gitSyncBusy && gitRemoteUrl.trim().length > 0;

  return (
    <div className="mobile-settings-screen">
      <div className="mobile-settings-sections" role="tablist" aria-label="Settings sections">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`mobile-settings-section-btn${activeSection === section.id ? " active" : ""}`}
            onClick={() => onSectionChange(section.id)}
            aria-current={activeSection === section.id ? "page" : undefined}
          >
            {section.label}
          </button>
        ))}
      </div>

      <div className="mobile-settings-scroll">
        {activeSection === "general" ? (
          <section className="mobile-settings-card" aria-label="General settings">
            <h2>General</h2>
            <p>Choose how notes appear in navigation.</p>
            <div className="mobile-segment" role="radiogroup" aria-label="Notes list location">
              <button
                type="button"
                className={`mobile-segment-btn${notesListMode === "separate" ? " active" : ""}`}
                onClick={() => onNotesListModeChange("separate")}
                aria-pressed={notesListMode === "separate"}
              >
                Separate panel
              </button>
              <button
                type="button"
                className={`mobile-segment-btn${notesListMode === "nested" ? " active" : ""}`}
                onClick={() => onNotesListModeChange("nested")}
                aria-pressed={notesListMode === "nested"}
              >
                Nested in folders
              </button>
            </div>
          </section>
        ) : null}

        {activeSection === "appearance" ? (
          <section className="mobile-settings-card" aria-label="Appearance settings">
            <h2>Appearance</h2>
            <p>Switch theme for this device.</p>
            <div className="mobile-segment" role="radiogroup" aria-label="Theme">
              <button
                type="button"
                className={`mobile-segment-btn${theme === "light" ? " active" : ""}`}
                onClick={() => onThemeChange("light")}
                aria-pressed={theme === "light"}
              >
                Light
              </button>
              <button
                type="button"
                className={`mobile-segment-btn${theme === "dark" ? " active" : ""}`}
                onClick={() => onThemeChange("dark")}
                aria-pressed={theme === "dark"}
              >
                Dark
              </button>
            </div>
          </section>
        ) : null}

        {activeSection === "sync" ? (
          <>
            <section className="mobile-settings-card" aria-label="Repository">
              <h2>Repository</h2>
              <p>Use the same remote + branch across desktop and iOS.</p>
              <label className="mobile-form-field">
                <span>Remote URL</span>
                <input
                  type="text"
                  value={gitRemoteUrl}
                  onChange={(event) => onGitRemoteUrlChange(event.target.value)}
                  placeholder="https://github.com/you/notes.git"
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </label>
              <label className="mobile-form-field">
                <span>Branch</span>
                <input
                  type="text"
                  value={gitBranch}
                  onChange={(event) => onGitBranchChange(event.target.value)}
                  placeholder="main"
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </label>
              <label className="mobile-form-field">
                <span>Commit message</span>
                <input
                  type="text"
                  value={gitCommitMessage}
                  onChange={(event) => onGitCommitMessageChange(event.target.value)}
                  placeholder="Sync notes"
                />
              </label>
            </section>

            <section className="mobile-settings-card" aria-label="Authentication">
              <h2>Authentication</h2>
              <p>For iOS, HTTPS + token is typically the most reliable setup.</p>
              <label className="mobile-form-field">
                <span>Username</span>
                <input
                  type="text"
                  value={gitUsername}
                  onChange={(event) => onGitUsernameChange(event.target.value)}
                  placeholder="Git username"
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </label>
              <label className="mobile-form-field">
                <span>Token / password</span>
                <input
                  type="password"
                  value={gitPassword}
                  onChange={(event) => onGitPasswordChange(event.target.value)}
                  placeholder="Personal access token"
                />
              </label>
            </section>

            <section className="mobile-settings-card" aria-label="Sync actions">
              <h2>Sync actions</h2>
              <p>Recommended cycle: Pull → edit → Push.</p>
              <div className="mobile-sync-actions">
                <button
                  type="button"
                  className="mobile-primary-btn"
                  disabled={!canConnect}
                  onClick={onGitConnect}
                >
                  {gitSyncBusy ? "Working..." : "Connect repo"}
                </button>
                <button type="button" className="mobile-secondary-btn" onClick={onGitRefresh} disabled={gitSyncBusy}>
                  Refresh
                </button>
                <button type="button" className="mobile-secondary-btn" onClick={onGitPull} disabled={!canPull}>
                  {gitSyncBusy ? "Working..." : gitStatus?.has_uncommitted_changes ? "Pull (Push first)" : "Pull"}
                </button>
                <button type="button" className="mobile-secondary-btn" onClick={onGitPush} disabled={!canPush}>
                  {gitSyncBusy ? "Working..." : "Push"}
                </button>
              </div>
            </section>

            <section className="mobile-settings-card mobile-status-card" aria-label="Sync status" role="status">
              <h2>Sync status</h2>
              <div className="mobile-status-grid">
                <div>
                  <span className="label">Last successful sync</span>
                  <span className="value">{lastSuccessfulSyncAt ?? "Never"}</span>
                </div>
                <div>
                  <span className="label">Repository</span>
                  <span className="value">{gitStatus?.repo_initialized ? "Connected" : "Not connected"}</span>
                </div>
                <div>
                  <span className="label">Branch</span>
                  <span className="value">{gitStatus?.current_branch || gitBranch || "-"}</span>
                </div>
                <div>
                  <span className="label">Remote</span>
                  <span className="value">{gitStatus?.remote_url ?? "Not connected"}</span>
                </div>
                <div>
                  <span className="label">Git available</span>
                  <span className="value">{gitStatus?.git_available ? "Yes" : "No"}</span>
                </div>
                <div>
                  <span className="label">Working tree</span>
                  <span className="value">{gitStatus?.has_uncommitted_changes ? "Local changes" : "Clean"}</span>
                </div>
                <div>
                  <span className="label">Ahead / behind</span>
                  <span className="value">
                    {gitStatus ? `${gitStatus.ahead} ahead / ${gitStatus.behind} behind` : "-"}
                  </span>
                </div>
                <div>
                  <span className="label">Notes root</span>
                  <span className="value">{gitStatus?.notes_root ?? "-"}</span>
                </div>
              </div>
            </section>

            {gitSyncError ? (
              <section className="mobile-sync-error" role="alert">
                <strong>Sync error</strong>
                <p>{gitSyncError}</p>
                {syncHint ? <p className="hint">{syncHint}</p> : null}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
