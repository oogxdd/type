import type { NotesListMode, SettingsSectionId, ThemeMode } from "../../components/SettingsPanel";
import type {
  GitSyncStatus,
  NotesSession,
  RecordingListItem,
  RecordingQueueSnapshot,
} from "../../types";
type GitSyncAction = "idle" | "refresh" | "connect" | "pull" | "push";

type MobileSettingsScreenProps = {
  activeSection: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  sections: Array<{ id: SettingsSectionId; label: string }>;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  sessions: NotesSession[];
  activeSessionId: string | null;
  sessionBusy: boolean;
  sessionError: string | null;
  onSessionChange: (sessionId: string) => void;
  onCreateSession: () => void;
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
  gitSyncAction: GitSyncAction;
  gitSyncError: string | null;
  onGitRefresh: () => void;
  onGitConnect: () => void;
  onGitPull: () => void;
  onGitPush: () => void;
  lastSuccessfulSyncAt: string | null;
  assemblyAiApiKey: string;
  onAssemblyAiApiKeyChange: (value: string) => void;
  mobileAutoTranscriptionEnabled: boolean;
  onMobileAutoTranscriptionChange: (enabled: boolean) => void;
  recordingSupported: boolean;
  isRecordingAudio: boolean;
  isRecordingBusy: boolean;
  recordingError: string | null;
  recordingStatus: string | null;
  recordingLiveStatus: string | null;
  recordingsQueue: RecordingQueueSnapshot | null;
  recordings: RecordingListItem[];
  recordingsBusy: boolean;
  recordingsError: string | null;
  activeAudioPath: string | null;
  activeAudioSrc: string | null;
  onRefreshRecordings: () => void;
  onPlayRecording: (audioPath: string) => void;
  onStartAudioRecording: () => void;
  onStopAudioRecording: () => void;
  onQueueRecordings: () => void;
};

const formatRecordingStatus = (item: RecordingListItem) => {
  if (item.is_processing) {
    return "processing";
  }
  if (item.is_queued) {
    return "queued";
  }
  return item.status;
};

const getSyncHint = (error: string | null): string | null => {
  if (!error) {
    return null;
  }
  const lower = error.toLowerCase();
  if (lower.includes("local changes detected")) {
    return "Pull blocked. Push local changes first.";
  }
  if (lower.includes("merge commit")) {
    return "Diverged history. Resolve on desktop, then pull on mobile.";
  }
  if (lower.includes("credentials")) {
    return "Authentication failed. Verify username and token.";
  }
  if (lower.includes("not initialized")) {
    return "Repository is not connected yet.";
  }
  return "Sync failed. Verify settings and retry.";
};

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mobile-native-group-wrap" aria-label={title}>
      <h3 className="mobile-native-group-title">{title}</h3>
      <div className="mobile-native-group">{children}</div>
    </section>
  );
}

function ChoiceRow({
  label,
  subtitle,
  selected,
  onClick,
}: {
  label: string;
  subtitle?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="mobile-native-row choice" onClick={onClick} aria-pressed={selected}>
      <span className="mobile-native-row-main">
        <span className="mobile-native-row-label">{label}</span>
        {subtitle ? <span className="mobile-native-row-sub">{subtitle}</span> : null}
      </span>
      <span className={`mobile-native-check${selected ? " active" : ""}`} aria-hidden>
        {selected ? "✓" : ""}
      </span>
    </button>
  );
}

function InputRow({
  label,
  value,
  onChange,
  placeholder,
  password,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  password?: boolean;
}) {
  return (
    <label className="mobile-native-input-row">
      <span className="mobile-native-input-label">{label}</span>
      <input
        type={password ? "password" : "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoCapitalize="off"
        autoCorrect="off"
      />
    </label>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mobile-native-row stat">
      <span className="mobile-native-row-label">{label}</span>
      <span className="mobile-native-row-value">{value}</span>
    </div>
  );
}

export function MobileSettingsScreen({
  activeSection,
  onSectionChange,
  sections,
  theme,
  onThemeChange,
  sessions,
  activeSessionId,
  sessionBusy,
  sessionError,
  onSessionChange,
  onCreateSession,
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
  gitSyncAction,
  gitSyncError,
  onGitRefresh,
  onGitConnect,
  onGitPull,
  onGitPush,
  lastSuccessfulSyncAt,
  assemblyAiApiKey,
  onAssemblyAiApiKeyChange,
  mobileAutoTranscriptionEnabled,
  onMobileAutoTranscriptionChange,
  recordingSupported,
  isRecordingAudio,
  isRecordingBusy,
  recordingError,
  recordingStatus,
  recordingLiveStatus,
  recordingsQueue,
  recordings,
  recordingsBusy,
  recordingsError,
  activeAudioPath,
  activeAudioSrc,
  onRefreshRecordings,
  onPlayRecording,
  onStartAudioRecording,
  onStopAudioRecording,
  onQueueRecordings,
}: MobileSettingsScreenProps) {
  const syncHint = getSyncHint(gitSyncError);
  const canPull = !gitSyncBusy && Boolean(gitStatus?.repo_initialized) && !gitStatus?.has_uncommitted_changes;
  const canPush = !gitSyncBusy && Boolean(gitStatus?.repo_initialized);
  const canConnect = !gitSyncBusy && gitRemoteUrl.trim().length > 0;
  const canQueue = !isRecordingBusy && assemblyAiApiKey.trim().length > 0;
  const syncActionLabel =
    gitSyncAction === "connect"
      ? "Connecting..."
      : gitSyncAction === "pull"
        ? "Pulling..."
        : gitSyncAction === "push"
          ? "Pushing..."
          : gitSyncAction === "refresh"
            ? "Refreshing..."
            : "Idle";

  const recorderState = !recordingSupported
    ? "Unsupported"
    : isRecordingAudio
      ? "Recording"
      : isRecordingBusy
        ? "Saving"
        : "Idle";

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

      <div className="mobile-settings-scroll mobile-settings-native">
        {activeSection === "general" ? (
          <>
            <Group title="Sessions">
              <div className="mobile-native-actions single">
                <button
                  type="button"
                  className="mobile-primary-btn"
                  onClick={onCreateSession}
                  disabled={sessionBusy}
                >
                  {sessionBusy ? "Working..." : "New session"}
                </button>
              </div>
              {sessions.length === 0 ? (
                <p className="mobile-native-note">No sessions available.</p>
              ) : (
                sessions.map((session) => (
                  <ChoiceRow
                    key={session.id}
                    label={session.name}
                    subtitle={session.id}
                    selected={activeSessionId === session.id}
                    onClick={() => onSessionChange(session.id)}
                  />
                ))
              )}
              {sessionError ? <p className="mobile-native-note">{sessionError}</p> : null}
            </Group>

            <Group title="Notes List">
              <ChoiceRow
                label="Separate panel"
                subtitle="Show notes in a dedicated list."
                selected={notesListMode === "separate"}
                onClick={() => onNotesListModeChange("separate")}
              />
              <ChoiceRow
                label="Nested in folders"
                subtitle="Show notes inside folder tree."
                selected={notesListMode === "nested"}
                onClick={() => onNotesListModeChange("nested")}
              />
            </Group>
          </>
        ) : null}

        {activeSection === "appearance" ? (
          <Group title="Theme">
            <ChoiceRow
              label="Light"
              selected={theme === "light"}
              onClick={() => onThemeChange("light")}
            />
            <ChoiceRow
              label="Dark"
              selected={theme === "dark"}
              onClick={() => onThemeChange("dark")}
            />
          </Group>
        ) : null}

        {activeSection === "sync" ? (
          <>
            <Group title="Repository">
              <InputRow label="Remote URL" value={gitRemoteUrl} onChange={onGitRemoteUrlChange} placeholder="https://github.com/you/notes.git" />
              <InputRow label="Branch" value={gitBranch} onChange={onGitBranchChange} placeholder="main" />
              <InputRow label="Commit message" value={gitCommitMessage} onChange={onGitCommitMessageChange} placeholder="Sync notes" />
            </Group>

            <Group title="Authentication">
              <InputRow label="Username" value={gitUsername} onChange={onGitUsernameChange} placeholder="Git username" />
              <InputRow label="Token / password" value={gitPassword} onChange={onGitPasswordChange} placeholder="Personal access token" password />
            </Group>

            <Group title="Actions">
              <div className="mobile-native-actions">
                <button type="button" className="mobile-primary-btn" onClick={onGitConnect} disabled={!canConnect}>
                  {gitSyncAction === "connect" ? "Connecting..." : "Connect repo"}
                </button>
                <button type="button" className="mobile-secondary-btn" onClick={onGitPull} disabled={!canPull}>
                  {gitSyncAction === "pull" ? "Pulling..." : "Pull"}
                </button>
                <button type="button" className="mobile-secondary-btn" onClick={onGitPush} disabled={!canPush}>
                  {gitSyncAction === "push" ? "Pushing..." : "Push"}
                </button>
                <button type="button" className="mobile-secondary-btn" onClick={onGitRefresh} disabled={gitSyncBusy}>
                  {gitSyncAction === "refresh" ? "Refreshing..." : "Refresh status"}
                </button>
              </div>
            </Group>

            <Group title="Status">
              <StatRow label="Last successful sync" value={lastSuccessfulSyncAt ?? "Never"} />
              <StatRow label="Repository" value={gitStatus?.repo_initialized ? "Connected" : "Not connected"} />
              <StatRow label="Branch" value={gitStatus?.current_branch || gitBranch || "-"} />
              <StatRow label="Remote URL" value={gitStatus?.remote_url ?? "-"} />
              <StatRow label="Working tree" value={gitStatus?.has_uncommitted_changes ? "Changes pending" : "Clean"} />
              <StatRow label="Push status" value={gitStatus?.push_required ? "Ready to push" : "Up to date"} />
              <StatRow
                label="Ahead / behind"
                value={gitStatus ? `${gitStatus.ahead} ahead / ${gitStatus.behind} behind` : "-"}
              />
              <StatRow label="Sync action" value={syncActionLabel} />
            </Group>

            <p className="mobile-native-note">
              Credentials are currently stored on this device. Use least-privilege tokens.
            </p>

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
            <Group title="Recorder">
              <StatRow label="Recorder state" value={recorderState} />
              <StatRow label="Device support" value={recordingSupported ? "Supported" : "Unsupported"} />
              <div className="mobile-native-actions">
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
            </Group>

            <Group title="Transcription">
              <InputRow
                label="AssemblyAI API key"
                value={assemblyAiApiKey}
                onChange={onAssemblyAiApiKeyChange}
                placeholder="Paste AssemblyAI key"
                password
              />
              <ChoiceRow
                label="Auto queue on mobile"
                subtitle="Retry unfinished recordings on launch and while app is open."
                selected={mobileAutoTranscriptionEnabled}
                onClick={() => onMobileAutoTranscriptionChange(true)}
              />
              <ChoiceRow
                label="Manual queue only"
                subtitle="Only queue when you tap Queue transcription."
                selected={!mobileAutoTranscriptionEnabled}
                onClick={() => onMobileAutoTranscriptionChange(false)}
              />
              <div className="mobile-native-actions single">
                <button type="button" className="mobile-secondary-btn" onClick={onQueueRecordings} disabled={!canQueue}>
                  Queue transcription
                </button>
                <button type="button" className="mobile-secondary-btn" onClick={onRefreshRecordings} disabled={recordingsBusy}>
                  {recordingsBusy ? "Refreshing..." : "Refresh queue"}
                </button>
              </div>
              <StatRow label="In-flight" value={String(recordingsQueue?.in_flight ?? 0)} />
              <StatRow label="Current job" value={recordingsQueue?.current_recording ?? "-"} />
              {recordingStatus ? <p className="mobile-native-note">{recordingStatus}</p> : null}
              {recordingLiveStatus ? (
                <p className="mobile-native-note">{recordingLiveStatus}</p>
              ) : null}
            </Group>

            <Group title="Recordings monitor">
              {recordings.length === 0 ? (
                <p className="mobile-native-note">No recordings yet.</p>
              ) : (
                recordings.map((item) => (
                  <div key={item.note_path} className="mobile-native-row stat mobile-recording-row">
                    <span className="mobile-native-row-main">
                      <span className="mobile-native-row-label">{item.note_path}</span>
                      <span className="mobile-native-row-sub">{formatRecordingStatus(item)}</span>
                    </span>
                    <button
                      type="button"
                      className="mobile-secondary-btn mobile-recording-play"
                      onClick={() => item.audio_path && onPlayRecording(item.audio_path)}
                      disabled={!item.audio_path}
                    >
                      {activeAudioPath && activeAudioPath === item.audio_path ? "Playing" : "Play"}
                    </button>
                  </div>
                ))
              )}
              {activeAudioSrc ? <audio className="mobile-recording-player" controls src={activeAudioSrc} /> : null}
            </Group>

            {recordingError ? (
              <section className="mobile-sync-error" role="alert">
                <strong>Recording error</strong>
                <p>{recordingError}</p>
              </section>
            ) : null}
            {recordingsError ? (
              <section className="mobile-sync-error" role="alert">
                <strong>Queue error</strong>
                <p>{recordingsError}</p>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
