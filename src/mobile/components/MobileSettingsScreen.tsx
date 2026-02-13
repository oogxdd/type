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
  assemblyAiApiKey: string;
  onAssemblyAiApiKeyChange: (value: string) => void;
  recordingSupported: boolean;
  isRecordingAudio: boolean;
  isRecordingBusy: boolean;
  recordingError: string | null;
  recordingStatus: string | null;
  onStartAudioRecording: () => void;
  onStopAudioRecording: () => void;
  onQueueRecordings: () => void;
};

const getSyncHint = (error: string | null): string | null => {
  if (!error) {
    return null;
  }
  const lower = error.toLowerCase();
  if (lower.includes("local changes detected")) {
    return "Pull is blocked because local changes are pending. Push first.";
  }
  if (lower.includes("merge commit")) {
    return "History diverged. Resolve on desktop, push, then pull on mobile.";
  }
  if (lower.includes("credentials")) {
    return "Authentication failed. Check username and token/password.";
  }
  if (lower.includes("not initialized")) {
    return "Repository is not connected yet. Use Connect repo first.";
  }
  return "Sync failed. Verify remote settings and network, then retry.";
};

const sectionMeta: Record<SettingsSectionId, { title: string; subtitle: string }> = {
  general: {
    title: "General",
    subtitle: "Control default navigation behavior and note list layout.",
  },
  appearance: {
    title: "Appearance",
    subtitle: "Tune this device for readability and comfort.",
  },
  sync: {
    title: "Sync",
    subtitle: "Git-based two-way sync across desktop and iOS.",
  },
  recordings: {
    title: "Recordings",
    subtitle: "Capture audio notes and queue transcription.",
  },
};

function SettingsChip({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
}) {
  return <span className={`mobile-settings-chip tone-${tone}`}>{label}</span>;
}

function OptionTile({
  label,
  description,
  active,
  onClick,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`mobile-option-tile${active ? " active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="tile-title">{label}</span>
      <span className="tile-description">{description}</span>
      <span className="tile-check" aria-hidden>
        {active ? "Selected" : "Tap to select"}
      </span>
    </button>
  );
}

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
  assemblyAiApiKey,
  onAssemblyAiApiKeyChange,
  recordingSupported,
  isRecordingAudio,
  isRecordingBusy,
  recordingError,
  recordingStatus,
  onStartAudioRecording,
  onStopAudioRecording,
  onQueueRecordings,
}: MobileSettingsScreenProps) {
  const syncHint = getSyncHint(gitSyncError);
  const canPull = !gitSyncBusy && Boolean(gitStatus?.repo_initialized) && !gitStatus?.has_uncommitted_changes;
  const canPush = !gitSyncBusy && Boolean(gitStatus?.repo_initialized);
  const canConnect = !gitSyncBusy && gitRemoteUrl.trim().length > 0;
  const canQueue = !isRecordingBusy && assemblyAiApiKey.trim().length > 0;

  const recorderState = !recordingSupported
    ? "Unsupported"
    : isRecordingAudio
      ? "Recording"
      : isRecordingBusy
        ? "Saving"
        : "Idle";

  const syncTone: "neutral" | "good" | "warn" | "bad" | "info" = gitSyncError
    ? "bad"
    : gitSyncBusy
      ? "info"
      : gitStatus?.repo_initialized
        ? "good"
        : "warn";

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
        <section className="mobile-settings-hero">
          <h2>{sectionMeta[activeSection].title}</h2>
          <p>{sectionMeta[activeSection].subtitle}</p>
          <div className="mobile-settings-chip-row">
            {activeSection === "sync" ? (
              <>
                <SettingsChip
                  label={
                    gitStatus?.repo_initialized
                      ? `Branch ${gitStatus.current_branch || gitBranch || "-"}`
                      : "Repository not connected"
                  }
                  tone={syncTone}
                />
                <SettingsChip
                  label={
                    gitStatus?.has_uncommitted_changes ? "Working tree: changes" : "Working tree: clean"
                  }
                  tone={gitStatus?.has_uncommitted_changes ? "warn" : "good"}
                />
              </>
            ) : null}

            {activeSection === "recordings" ? (
              <>
                <SettingsChip label={`Recorder: ${recorderState}`} tone={isRecordingAudio ? "info" : "neutral"} />
                <SettingsChip
                  label={assemblyAiApiKey.trim() ? "Transcription enabled" : "Transcription key missing"}
                  tone={assemblyAiApiKey.trim() ? "good" : "warn"}
                />
              </>
            ) : null}

            {activeSection === "appearance" ? (
              <SettingsChip label={`Theme: ${theme === "dark" ? "Dark" : "Light"}`} tone="neutral" />
            ) : null}

            {activeSection === "general" ? (
              <SettingsChip
                label={`Notes list: ${notesListMode === "nested" ? "Nested in folders" : "Separate panel"}`}
                tone="neutral"
              />
            ) : null}
          </div>
        </section>

        {activeSection === "general" ? (
          <section className="mobile-settings-card" aria-label="General settings">
            <div className="mobile-card-title-row">
              <h3>Notes list location</h3>
              <span>How notes are shown in navigation</span>
            </div>
            <div className="mobile-option-grid">
              <OptionTile
                label="Separate panel"
                description="Classic two-column browsing with dedicated notes list."
                active={notesListMode === "separate"}
                onClick={() => onNotesListModeChange("separate")}
              />
              <OptionTile
                label="Nested in folders"
                description="Display notes inline under folders in the navigation tree."
                active={notesListMode === "nested"}
                onClick={() => onNotesListModeChange("nested")}
              />
            </div>
          </section>
        ) : null}

        {activeSection === "appearance" ? (
          <section className="mobile-settings-card" aria-label="Appearance settings">
            <div className="mobile-card-title-row">
              <h3>Theme</h3>
              <span>Applies only to this device</span>
            </div>
            <div className="mobile-option-grid compact">
              <OptionTile
                label="Light"
                description="High contrast on bright background."
                active={theme === "light"}
                onClick={() => onThemeChange("light")}
              />
              <OptionTile
                label="Dark"
                description="Reduced glare in low-light environments."
                active={theme === "dark"}
                onClick={() => onThemeChange("dark")}
              />
            </div>
          </section>
        ) : null}

        {activeSection === "sync" ? (
          <>
            <section className="mobile-settings-card" aria-label="Repository">
              <div className="mobile-card-title-row">
                <h3>Repository</h3>
                <span>Use same remote and branch on all devices</span>
              </div>
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
              <div className="mobile-card-title-row">
                <h3>Authentication</h3>
                <span>Recommended on iOS: HTTPS + personal access token</span>
              </div>
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
              <div className="mobile-card-title-row">
                <h3>Sync actions</h3>
                <span>Recommended flow: Pull → edit → Push</span>
              </div>
              <div className="mobile-sync-actions stacked">
                <button
                  type="button"
                  className="mobile-primary-btn"
                  disabled={!canConnect}
                  onClick={onGitConnect}
                >
                  {gitSyncBusy ? "Working..." : "Connect repo"}
                </button>
                <div className="mobile-sync-actions">
                  <button
                    type="button"
                    className="mobile-secondary-btn"
                    onClick={onGitPull}
                    disabled={!canPull}
                  >
                    {gitSyncBusy ? "Working..." : gitStatus?.has_uncommitted_changes ? "Pull (Push first)" : "Pull"}
                  </button>
                  <button type="button" className="mobile-secondary-btn" onClick={onGitPush} disabled={!canPush}>
                    {gitSyncBusy ? "Working..." : "Push"}
                  </button>
                  <button
                    type="button"
                    className="mobile-secondary-btn full"
                    onClick={onGitRefresh}
                    disabled={gitSyncBusy}
                  >
                    Refresh status
                  </button>
                </div>
              </div>
            </section>

            <section className="mobile-settings-card mobile-status-card" aria-label="Sync status" role="status">
              <div className="mobile-card-title-row">
                <h3>Sync status</h3>
                <span>Current repository state</span>
              </div>
              <div className="mobile-status-grid two-col">
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
                  <span className="label">Git available</span>
                  <span className="value">{gitStatus?.git_available ? "Yes" : "No"}</span>
                </div>
                <div>
                  <span className="label">Working tree</span>
                  <span className="value">{gitStatus?.has_uncommitted_changes ? "Changes pending" : "Clean"}</span>
                </div>
                <div>
                  <span className="label">Ahead / behind</span>
                  <span className="value">
                    {gitStatus ? `${gitStatus.ahead} ahead / ${gitStatus.behind} behind` : "-"}
                  </span>
                </div>
                <div className="wide">
                  <span className="label">Remote URL</span>
                  <span className="value">{gitStatus?.remote_url ?? "Not connected"}</span>
                </div>
                <div className="wide">
                  <span className="label">Notes root</span>
                  <span className="value">{gitStatus?.notes_root ?? "-"}</span>
                </div>
              </div>
            </section>

            <section className="mobile-settings-card mobile-security-card" aria-label="Security">
              <div className="mobile-card-title-row">
                <h3>Security note</h3>
                <span>Current implementation detail</span>
              </div>
              <p>
                Credentials are stored locally on this device. Use least-privilege tokens and rotate regularly.
              </p>
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

        {activeSection === "recordings" ? (
          <>
            <section className="mobile-settings-card" aria-label="Recorder">
              <div className="mobile-card-title-row">
                <h3>Recorder</h3>
                <span>Audio files are saved under Recordings/recording-*/audio.*</span>
              </div>
              <div className="mobile-status-grid two-col">
                <div>
                  <span className="label">Recorder state</span>
                  <span className="value">{recorderState}</span>
                </div>
                <div>
                  <span className="label">Device support</span>
                  <span className="value">{recordingSupported ? "Supported" : "Unsupported"}</span>
                </div>
              </div>
              <div className="mobile-sync-actions">
                <button
                  type="button"
                  className="mobile-primary-btn"
                  onClick={onStartAudioRecording}
                  disabled={!recordingSupported || isRecordingAudio || isRecordingBusy}
                >
                  Start recording
                </button>
                <button
                  type="button"
                  className="mobile-secondary-btn"
                  onClick={onStopAudioRecording}
                  disabled={!recordingSupported || !isRecordingAudio}
                >
                  Stop and save
                </button>
              </div>
            </section>

            <section className="mobile-settings-card" aria-label="Transcription">
              <div className="mobile-card-title-row">
                <h3>Transcription</h3>
                <span>Queue pending recordings for AssemblyAI on demand</span>
              </div>
              <label className="mobile-form-field">
                <span>AssemblyAI API key</span>
                <input
                  type="password"
                  value={assemblyAiApiKey}
                  onChange={(event) => onAssemblyAiApiKeyChange(event.target.value)}
                  placeholder="Paste AssemblyAI key"
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </label>
              <div className="mobile-sync-actions">
                <button type="button" className="mobile-secondary-btn full" onClick={onQueueRecordings} disabled={!canQueue}>
                  Queue transcription
                </button>
              </div>
              {recordingStatus ? (
                <div className="mobile-status-grid">
                  <div>
                    <span className="label">Last queue result</span>
                    <span className="value">{recordingStatus}</span>
                  </div>
                </div>
              ) : null}
            </section>

            {recordingError ? (
              <section className="mobile-sync-error" role="alert">
                <strong>Recording error</strong>
                <p>{recordingError}</p>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
