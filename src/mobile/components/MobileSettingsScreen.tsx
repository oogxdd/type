import { useEffect, useMemo, useState } from "react";
import type { SettingsSectionId } from "../../components/SettingsPanel";
import { formatRecordingStatus, formatHistoryTime, getSyncHint } from "../../utils/format";
import { useTheme } from "../../contexts/ThemeContext";
import { useSessions } from "../../contexts/SessionsContext";
import { useGitSync } from "../../contexts/GitSyncContext";
import { useRecordings } from "../../contexts/RecordingsContext";
import { useSelection } from "../../contexts/SelectionContext";
import { useNotesTree } from "../../contexts/NotesTreeContext";

type MobileSettingsScreenProps = {
  activeSection: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  sections: Array<{ id: SettingsSectionId; label: string }>;
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
}: MobileSettingsScreenProps) {
  const { theme, setTheme, notesListMode, setNotesListMode } = useTheme();
  const {
    sessions,
    activeSessionId,
    sessionsBusy,
    sessionsError,
    switchSession,
    createSession,
    syncSettings,
    updateSyncSettings,
  } = useSessions();
  const {
    gitStatus,
    gitSyncAction,
    gitSyncError,
    gitSyncBusy,
    gitSyncHistory,
    refreshGitStatus,
    connectGitRepo,
    gitPull,
    gitPush,
  } = useGitSync();
  const {
    recordingSupported,
    isRecordingAudio,
    isRecordingFinalizing,
    recorderError,
    recordingStatusMessage,
    recordingLiveStatus,
    transcriptionQueueBusy,
    recordingsQueue,
    recordingsList,
    recordingsBusy,
    recordingsError,
    activeAudioPath,
    activeAudioSrc,
    startRecording,
    stopRecording,
    refreshRecordings,
    playRecording,
    queueRecordingTranscriptions,
  } = useRecordings();
  const { activeFolder } = useSelection();
  const { refreshTree } = useNotesTree();

  const isRecordingBusy = isRecordingFinalizing || transcriptionQueueBusy;

  const lastSuccessfulSyncAt = syncSettings.lastSuccessfulSyncAt
    ? new Date(syncSettings.lastSuccessfulSyncAt).toLocaleString()
    : null;

  const syncHint = getSyncHint(gitSyncError);
  const canPull = !gitSyncBusy && Boolean(gitStatus?.repo_initialized) && !gitStatus?.has_uncommitted_changes;
  const canPush = !gitSyncBusy && Boolean(gitStatus?.repo_initialized);
  const canConnect = !gitSyncBusy && syncSettings.gitRemoteUrl.trim().length > 0;
  const canQueue = !isRecordingBusy && syncSettings.assemblyAiApiKey.trim().length > 0;
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
  const [syncView, setSyncView] = useState<"credentials" | "actions">("actions");
  const [selectedSyncHistoryId, setSelectedSyncHistoryId] = useState<string | null>(null);

  const visibleSyncHistory = useMemo(
    () =>
      gitSyncHistory
        .filter((item) => item.action === "pull" || item.action === "push")
        .slice(0, 12),
    [gitSyncHistory]
  );
  const selectedSyncHistory = useMemo(() => {
    if (visibleSyncHistory.length === 0) {
      return null;
    }
    if (!selectedSyncHistoryId) {
      return visibleSyncHistory[0];
    }
    return visibleSyncHistory.find((item) => item.id === selectedSyncHistoryId) ?? visibleSyncHistory[0];
  }, [selectedSyncHistoryId, visibleSyncHistory]);

  useEffect(() => {
    if (activeSection !== "sync") {
      return;
    }
    if (visibleSyncHistory.length === 0) {
      if (selectedSyncHistoryId) {
        setSelectedSyncHistoryId(null);
      }
      return;
    }
    if (!selectedSyncHistoryId || !visibleSyncHistory.some((item) => item.id === selectedSyncHistoryId)) {
      setSelectedSyncHistoryId(visibleSyncHistory[0].id);
    }
  }, [activeSection, selectedSyncHistoryId, visibleSyncHistory]);

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
                  onClick={() => void createSession()}
                  disabled={sessionsBusy}
                >
                  {sessionsBusy ? "Working..." : "New session"}
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
                    onClick={() => void switchSession(session.id)}
                  />
                ))
              )}
              {sessionsError ? <p className="mobile-native-note">{sessionsError}</p> : null}
            </Group>

            <Group title="Notes List">
              <ChoiceRow
                label="Separate panel"
                subtitle="Show notes in a dedicated list."
                selected={notesListMode === "separate"}
                onClick={() => setNotesListMode("separate")}
              />
              <ChoiceRow
                label="Nested in folders"
                subtitle="Show notes inside folder tree."
                selected={notesListMode === "nested"}
                onClick={() => setNotesListMode("nested")}
              />
            </Group>
          </>
        ) : null}

        {activeSection === "appearance" ? (
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
        ) : null}

        {activeSection === "sync" ? (
          <>
            <Group title="Sync views">
              <div className="mobile-segment">
                <button
                  type="button"
                  className={`mobile-segment-btn${syncView === "credentials" ? " active" : ""}`}
                  onClick={() => setSyncView("credentials")}
                >
                  Credentials
                </button>
                <button
                  type="button"
                  className={`mobile-segment-btn${syncView === "actions" ? " active" : ""}`}
                  onClick={() => setSyncView("actions")}
                >
                  Actions
                </button>
              </div>
            </Group>

            {syncView === "credentials" ? (
              <>
                <Group title="Repository">
                  <InputRow
                    label="Remote URL"
                    value={syncSettings.gitRemoteUrl}
                    onChange={(v) => updateSyncSettings({ gitRemoteUrl: v })}
                    placeholder="https://github.com/you/notes.git"
                  />
                  <InputRow label="Branch" value={syncSettings.gitBranch} onChange={(v) => updateSyncSettings({ gitBranch: v })} placeholder="main" />
                  <InputRow
                    label="Commit message"
                    value={syncSettings.gitCommitMessage}
                    onChange={(v) => updateSyncSettings({ gitCommitMessage: v })}
                    placeholder="Sync notes"
                  />
                </Group>

                <Group title="Authentication">
                  <InputRow
                    label="Username"
                    value={syncSettings.gitUsername}
                    onChange={(v) => updateSyncSettings({ gitUsername: v })}
                    placeholder="Git username"
                  />
                  <InputRow
                    label="Token / password"
                    value={syncSettings.gitPassword}
                    onChange={(v) => updateSyncSettings({ gitPassword: v })}
                    placeholder="Personal access token"
                    password
                  />
                </Group>

                <p className="mobile-native-note">
                  Credentials are stored on this device. Use least-privilege tokens.
                </p>
              </>
            ) : (
              <>
                <Group title="Actions">
                  <div className="mobile-native-actions">
                    <button
                      type="button"
                      className="mobile-primary-btn"
                      onClick={() => void connectGitRepo()}
                      disabled={!canConnect}
                    >
                      {gitSyncAction === "connect" ? "Connecting..." : "Connect repo"}
                    </button>
                    <button type="button" className="mobile-secondary-btn" onClick={() => void gitPull({ onAfterPull: () => refreshTree() })} disabled={!canPull}>
                      {gitSyncAction === "pull" ? "Pulling..." : "Pull"}
                    </button>
                    <button type="button" className="mobile-secondary-btn" onClick={() => void gitPush()} disabled={!canPush}>
                      {gitSyncAction === "push" ? "Pushing..." : "Push"}
                    </button>
                    <button
                      type="button"
                      className="mobile-secondary-btn"
                      onClick={() => void refreshGitStatus()}
                      disabled={gitSyncBusy}
                    >
                      {gitSyncAction === "refresh" ? "Refreshing..." : "Refresh status"}
                    </button>
                  </div>
                </Group>

                <Group title="Status">
                  <StatRow label="Last successful sync" value={lastSuccessfulSyncAt ?? "Never"} />
                  <StatRow label="Repository" value={gitStatus?.repo_initialized ? "Connected" : "Not connected"} />
                  <StatRow label="Branch" value={gitStatus?.current_branch || syncSettings.gitBranch || "-"} />
                  <StatRow label="Remote URL" value={gitStatus?.remote_url ?? "-"} />
                  <StatRow
                    label="Working tree"
                    value={gitStatus?.has_uncommitted_changes ? "Changes pending" : "Clean"}
                  />
                  <StatRow label="Push status" value={gitStatus?.push_required ? "Ready to push" : "Up to date"} />
                  <StatRow
                    label="Ahead / behind"
                    value={gitStatus ? `${gitStatus.ahead} ahead / ${gitStatus.behind} behind` : "-"}
                  />
                  <StatRow label="Sync action" value={syncActionLabel} />
                </Group>

                <Group title="Recent pull/push">
                  {visibleSyncHistory.length === 0 ? (
                    <p className="mobile-native-note">No pull/push history yet.</p>
                  ) : (
                    visibleSyncHistory.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`mobile-native-row choice mobile-sync-history-row${selectedSyncHistory?.id === item.id ? " active" : ""}`}
                        onClick={() => setSelectedSyncHistoryId(item.id)}
                      >
                        <span className="mobile-native-row-main">
                          <span className="mobile-native-row-label">
                            {item.action === "pull"
                              ? "Pull"
                              : item.action === "push"
                                ? "Push"
                                : "Connect repo"}
                          </span>
                          <span className="mobile-native-row-sub">
                            {formatHistoryTime(item.finished_at)} · {item.branch || "-"}
                          </span>
                        </span>
                        <span className="mobile-native-row-value">
                          {item.status === "success" ? "Success" : "Failed"}
                        </span>
                      </button>
                    ))
                  )}
                </Group>

                {selectedSyncHistory ? (
                  <Group title="Action details">
                    <StatRow
                      label="Action"
                      value={
                        selectedSyncHistory.action === "pull"
                          ? "Pull"
                          : selectedSyncHistory.action === "push"
                            ? "Push"
                            : "Connect repo"
                      }
                    />
                    <StatRow
                      label="Result"
                      value={selectedSyncHistory.status === "success" ? "Success" : "Failed"}
                    />
                    <StatRow
                      label="When"
                      value={`${formatHistoryTime(selectedSyncHistory.started_at)} → ${formatHistoryTime(selectedSyncHistory.finished_at)}`}
                    />
                    <StatRow label="Branch" value={selectedSyncHistory.branch || "-"} />
                    <StatRow label="Remote URL" value={selectedSyncHistory.remote_url || "-"} />
                    <StatRow
                      label="Ahead / behind (before)"
                      value={
                        selectedSyncHistory.before
                          ? `${selectedSyncHistory.before.ahead} ahead / ${selectedSyncHistory.before.behind} behind`
                          : "-"
                      }
                    />
                    <StatRow
                      label="Ahead / behind (after)"
                      value={
                        selectedSyncHistory.after
                          ? `${selectedSyncHistory.after.ahead} ahead / ${selectedSyncHistory.after.behind} behind`
                          : "-"
                      }
                    />
                    {selectedSyncHistory.commit_message ? (
                      <StatRow label="Commit message" value={selectedSyncHistory.commit_message} />
                    ) : null}
                    {selectedSyncHistory.error_message ? (
                      <p className="mobile-native-note">{selectedSyncHistory.error_message}</p>
                    ) : null}
                  </Group>
                ) : null}

                {gitSyncError ? (
                  <section className="mobile-sync-error" role="alert">
                    <strong>Sync error</strong>
                    <p>{gitSyncError}</p>
                    {syncHint ? <p className="hint">{syncHint}</p> : null}
                  </section>
                ) : null}
              </>
            )}
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
                  onClick={() => void startRecording(activeFolder || undefined)}
                  disabled={!recordingSupported || isRecordingAudio || isRecordingBusy}
                >
                  Start recording
                </button>
                <button
                  type="button"
                  className="mobile-secondary-btn"
                  onClick={stopRecording}
                  disabled={!recordingSupported || !isRecordingAudio}
                >
                  Stop and save
                </button>
              </div>
            </Group>

            <Group title="Transcription">
              <InputRow
                label="AssemblyAI API key"
                value={syncSettings.assemblyAiApiKey}
                onChange={(v) => updateSyncSettings({ assemblyAiApiKey: v })}
                placeholder="Paste AssemblyAI key"
                password
              />
              <ChoiceRow
                label="Auto queue on mobile"
                subtitle="Retry unfinished recordings on launch and while app is open."
                selected={syncSettings.mobileAutoTranscriptionEnabled}
                onClick={() => updateSyncSettings({ mobileAutoTranscriptionEnabled: true })}
              />
              <ChoiceRow
                label="Manual queue only"
                subtitle="Only queue when you tap Queue transcription."
                selected={!syncSettings.mobileAutoTranscriptionEnabled}
                onClick={() => updateSyncSettings({ mobileAutoTranscriptionEnabled: false })}
              />
              <div className="mobile-native-actions single">
                <button type="button" className="mobile-secondary-btn" onClick={() => void queueRecordingTranscriptions("manual")} disabled={!canQueue}>
                  Queue transcription
                </button>
                <button type="button" className="mobile-secondary-btn" onClick={() => void refreshRecordings()} disabled={recordingsBusy}>
                  {recordingsBusy ? "Refreshing..." : "Refresh queue"}
                </button>
              </div>
              <StatRow label="In-flight" value={String(recordingsQueue?.in_flight ?? 0)} />
              <StatRow label="Current job" value={recordingsQueue?.current_recording ?? "-"} />
              {recordingStatusMessage ? <p className="mobile-native-note">{recordingStatusMessage}</p> : null}
              {recordingLiveStatus ? (
                <p className="mobile-native-note">{recordingLiveStatus}</p>
              ) : null}
            </Group>

            <Group title="Recordings monitor">
              {recordingsList.length === 0 ? (
                <p className="mobile-native-note">No recordings yet.</p>
              ) : (
                recordingsList.map((item) => (
                  <div key={item.note_path} className="mobile-native-row stat mobile-recording-row">
                    <span className="mobile-native-row-main">
                      <span className="mobile-native-row-label">{item.note_path}</span>
                      <span className="mobile-native-row-sub">{formatRecordingStatus(item)}</span>
                    </span>
                    <button
                      type="button"
                      className="mobile-secondary-btn mobile-recording-play"
                      onClick={() => item.audio_path && void playRecording(item.audio_path)}
                      disabled={!item.audio_path}
                    >
                      {activeAudioPath && activeAudioPath === item.audio_path ? "Playing" : "Play"}
                    </button>
                  </div>
                ))
              )}
              {activeAudioSrc ? (
                <audio
                  className="mobile-recording-player"
                  controls
                  autoPlay
                  playsInline
                  src={activeAudioSrc}
                />
              ) : null}
            </Group>

            {recorderError ? (
              <section className="mobile-sync-error" role="alert">
                <strong>Recording error</strong>
                <p>{recorderError}</p>
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
