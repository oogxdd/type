import { Button } from "../ui/button";
import type { NotesListMode } from "../SettingsPanel";
import { useTheme } from "../../contexts/ThemeContext";
import { useSessions } from "../../contexts/SessionsContext";
import { useGitSync } from "../../contexts/GitSyncContext";

export function SettingsGeneralSection() {
  const { notesListMode, setNotesListMode } = useTheme();
  const {
    sessions,
    activeSessionId,
    sessionsBusy,
    sessionsError,
    switchSession,
    createSession,
  } = useSessions();
  const { gitStatus } = useGitSync();

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
