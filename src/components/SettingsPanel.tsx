import { Button } from "./ui/button";
import { formatRecordingStatus, formatUpdatedAt } from "../utils/format";
import { useTheme } from "../contexts/ThemeContext";
import { useSessions } from "../contexts/SessionsContext";
import { useGitSync } from "../contexts/GitSyncContext";
import { useRecordings } from "../contexts/RecordingsContext";
import { useNotesTree } from "../contexts/NotesTreeContext";
import { useEditor } from "../contexts/EditorContext";

export type ThemeMode = "light" | "dark";
export type NotesListMode = "separate" | "nested";

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "sync"
  | "recordings";
type SettingsSection = {
  id: SettingsSectionId;
  title: string;
  description: string;
};

const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "general", title: "General", description: "Basic app behavior and defaults." },
  { id: "appearance", title: "Appearance", description: "Theme and visual style." },
  { id: "sync", title: "Sync", description: "Cloud sync, refresh policy, and conflict rules." },
  {
    id: "recordings",
    title: "Recordings",
    description: "Audio capture, transcription queue, and AssemblyAI settings.",
  },
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
}: {
  sectionId: SettingsSectionId;
}) {
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
    refreshGitStatus,
    connectGitRepo,
    gitPull,
    gitPush,
  } = useGitSync();
  const { refreshTree } = useNotesTree();
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

  const isRecordingBusy = isRecordingFinalizing || transcriptionQueueBusy;

  const canPull =
    !gitSyncBusy &&
    Boolean(gitStatus?.repo_initialized) &&
    !gitStatus?.has_uncommitted_changes;
  const canPush = !gitSyncBusy && Boolean(gitStatus?.repo_initialized);
  const canConnect = !gitSyncBusy && syncSettings.gitRemoteUrl.trim().length > 0;
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

  if (sectionId === "general") {
    return (
      <>
        <h2 className="settings-detail-title">General</h2>
        <p className="settings-detail-text">Default behavior.</p>
        <label className="settings-control">
          <span>Active session</span>
          <div className="settings-inline-row">
            <select
              value={activeSessionId ?? ""}
              onChange={(event) => void switchSession(event.target.value)}
              disabled={sessionsBusy || sessions.length === 0}
            >
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void createSession()}
              disabled={sessionsBusy}
            >
              {sessionsBusy ? "Working..." : "New session"}
            </Button>
          </div>
          <span className="settings-inline-help">
            Each session has its own local notes folder and Git remote.
          </span>
        </label>
        {sessionsError ? (
          <p className="settings-warning-text settings-inline-warning">{sessionsError}</p>
        ) : null}
        <div className="settings-info-grid">
          <div className="settings-info-row">
            <span>Notes source folder</span>
            <code>{gitStatus?.notes_root || "-"}</code>
          </div>
        </div>
        <label className="settings-control">
          <span>Notes list location</span>
          <select
            value={notesListMode}
            onChange={(event) =>
              setNotesListMode(event.target.value as NotesListMode)
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
            onChange={(event) => setTheme(event.target.value as ThemeMode)}
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
            value={syncSettings.gitRemoteUrl}
            onChange={(event) => updateSyncSettings({ gitRemoteUrl: event.target.value })}
            placeholder="https://github.com/you/notes.git"
          />
        </label>
        <label className="settings-control">
          <span>Branch</span>
          <input
            type="text"
            value={syncSettings.gitBranch}
            onChange={(event) => updateSyncSettings({ gitBranch: event.target.value })}
            placeholder="main"
          />
        </label>
        <label className="settings-control">
          <span>Commit message</span>
          <input
            type="text"
            value={syncSettings.gitCommitMessage}
            onChange={(event) => updateSyncSettings({ gitCommitMessage: event.target.value })}
            placeholder="Sync notes"
          />
        </label>
        <label className="settings-control">
          <span>Git username (optional, for HTTPS auth)</span>
          <input
            type="text"
            value={syncSettings.gitUsername}
            onChange={(event) => updateSyncSettings({ gitUsername: event.target.value })}
            placeholder="your-github-username"
          />
        </label>
        <label className="settings-control">
          <span>Git token/password (optional)</span>
          <input
            type="password"
            value={syncSettings.gitPassword}
            onChange={(event) => updateSyncSettings({ gitPassword: event.target.value })}
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
            <span>Push status</span>
            <code>{gitStatus?.push_required ? "ready to push" : "up to date"}</code>
          </div>
          <div className="settings-info-row">
            <span>Ahead / behind</span>
            <code>
              {gitStatus ? `${gitStatus.ahead} ahead / ${gitStatus.behind} behind` : "-"}
            </code>
          </div>
          <div className="settings-info-row">
            <span>Sync action</span>
            <code>{syncActionLabel}</code>
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
          <Button variant="outline" size="sm" type="button" onClick={() => void refreshGitStatus()} disabled={gitSyncBusy}>
            {gitSyncAction === "refresh" ? "Refreshing..." : "Refresh status"}
          </Button>
          <Button size="sm" type="button" onClick={() => void connectGitRepo()} disabled={!canConnect}>
            {gitSyncAction === "connect" ? "Connecting..." : "Connect repo"}
          </Button>
          <Button variant="secondary" size="sm" type="button" onClick={() => void gitPull({ onAfterPull: () => refreshTree() })} disabled={!canPull}>
            {gitSyncAction === "pull" ? "Pulling..." : "Pull"}
          </Button>
          <Button variant="secondary" size="sm" type="button" onClick={() => void gitPush()} disabled={!canPush}>
            {gitSyncAction === "push" ? "Pushing..." : "Push"}
          </Button>
        </div>
      </>
    );
  }
  if (sectionId === "recordings") {
    return (
      <>
        <h2 className="settings-detail-title">Recordings</h2>
        <p className="settings-detail-text">
          Recordings are saved as regular notes with front matter metadata.
          <br />
          Audio files are stored in <code>_Recordings</code>.
          <br />
          Pending recordings can be queued for AssemblyAI transcription.
        </p>
        <label className="settings-control">
          <span>AssemblyAI API key</span>
          <input
            type="password"
            value={syncSettings.assemblyAiApiKey}
            onChange={(event) => updateSyncSettings({ assemblyAiApiKey: event.target.value })}
            placeholder="Paste AssemblyAI key"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        <div className="settings-control">
          <span>Mobile transcription</span>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={syncSettings.mobileAutoTranscriptionEnabled}
              onChange={(event) =>
                updateSyncSettings({ mobileAutoTranscriptionEnabled: event.target.checked })
              }
            />
            <span>Auto-queue on mobile</span>
          </label>
          <span className="settings-inline-help">
            Re-queues unfinished recordings on launch and while the mobile app stays open.
          </span>
        </div>
        <div className="settings-info-grid">
          <div className="settings-info-row">
            <span>Recorder</span>
            <code>
              {!recordingSupported
                ? "unsupported"
                : isRecordingAudio
                  ? "recording"
                  : isRecordingBusy
                    ? "saving"
                    : "idle"}
            </code>
          </div>
          <div className="settings-info-row">
            <span>Transcription mode</span>
            <code>{syncSettings.assemblyAiApiKey.trim() ? "enabled" : "api key required"}</code>
          </div>
          <div className="settings-info-row">
            <span>Queue in-flight</span>
            <code>{recordingsQueue?.in_flight ?? 0}</code>
          </div>
          <div className="settings-info-row">
            <span>Queue active job</span>
            <code>{recordingsQueue?.current_recording ?? "-"}</code>
          </div>
        </div>
        {recordingStatusMessage ? (
          <label className="settings-control">
            <span>Last queue result</span>
            <span className="settings-inline-help">{recordingStatusMessage}</span>
          </label>
        ) : null}
        {recordingLiveStatus ? (
          <label className="settings-control">
            <span>Live recorder</span>
            <span className="settings-inline-help">{recordingLiveStatus}</span>
          </label>
        ) : null}
        {recorderError ? (
          <p className="settings-warning-text settings-inline-warning">{recorderError}</p>
        ) : null}
        <div className="settings-action-row">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => void startRecording()}
            disabled={!recordingSupported || isRecordingAudio || isRecordingBusy}
          >
            Start recording
          </Button>
          <Button
            size="sm"
            type="button"
            onClick={stopRecording}
            disabled={!recordingSupported || !isRecordingAudio}
          >
            Stop and save
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => void refreshRecordings()}
            disabled={recordingsBusy}
          >
            {recordingsBusy ? "Refreshing..." : "Refresh queue"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => void queueRecordingTranscriptions("manual")}
            disabled={!syncSettings.assemblyAiApiKey.trim() || isRecordingBusy}
          >
            Queue transcription
          </Button>
        </div>
        {recordingsError ? (
          <p className="settings-warning-text settings-inline-warning">{recordingsError}</p>
        ) : null}
        <div className="settings-control">
          <span>Recordings monitor</span>
          <div className="settings-recordings-list">
            {recordingsList.length === 0 ? (
              <div className="settings-recording-row empty">No recordings yet.</div>
            ) : (
              recordingsList.map((item) => {
                const currentStatus = formatRecordingStatus(item);
                const canPlay = Boolean(item.audio_path);
                return (
                  <div key={item.note_path} className="settings-recording-row">
                    <div className="settings-recording-main">
                      <div className="settings-recording-title">{item.note_path}</div>
                      <div className="settings-recording-meta">
                        <code>{currentStatus}</code>
                        <span>updated {formatUpdatedAt(item.updated_ms)}</span>
                      </div>
                      {item.error ? (
                        <p className="settings-warning-text settings-inline-warning">{item.error}</p>
                      ) : null}
                    </div>
                    <div className="settings-recording-actions">
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={() => item.audio_path && void playRecording(item.audio_path)}
                        disabled={!canPlay}
                      >
                        {activeAudioPath && activeAudioPath === item.audio_path ? "Playing" : "Play"}
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {activeAudioSrc ? <audio className="settings-recording-player" controls src={activeAudioSrc} /> : null}
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
  onPaneClick,
}: {
  activeSection: string;
  onPaneClick: () => void;
}) {
  const { rightPaneRef } = useEditor();

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
        />
      </div>
    </div>
  );
}
