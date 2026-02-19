import { useSessions } from "../../../contexts/SessionsContext";
import { Group, ChoiceRow, InputRow, StatRow } from "./SettingsHelpers";
import { useEffect, useMemo, useState } from "react";

export function MobileGeneralSection() {
  const {
    sessions,
    activeSessionId,
    activeSessionNotesRoot,
    sessionsBusy,
    sessionsError,
    switchSession,
    createSession,
    setSessionNotesRoot,
  } = useSessions();
  const [notesRootInput, setNotesRootInput] = useState("");

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );

  useEffect(() => {
    setNotesRootInput(activeSession?.notes_root ?? "");
  }, [activeSession?.notes_root]);

  return (
    <>
      <Group title="Session">
        <StatRow label="Current" value={activeSession?.name ?? "No session"} />
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
        {sessionsError ? <p className="mobile-native-note">{sessionsError}</p> : null}
      </Group>

      <Group title="Switch session">
        {sessions.length === 0 ? (
          <p className="mobile-native-note">No sessions available.</p>
        ) : (
          sessions.map((session) => (
            <ChoiceRow
              key={session.id}
              label={session.name}
              selected={activeSessionId === session.id}
              onClick={() => void switchSession(session.id)}
            />
          ))
        )}
      </Group>

      <Group title="Notes folder">
        <StatRow label="Current path" value={activeSessionNotesRoot || "-"} />
        <InputRow
          label="New path"
          value={notesRootInput}
          onChange={setNotesRootInput}
          placeholder="/Users/you/Documents/type"
          disabled={!activeSessionId || sessionsBusy}
        />
        <div className="mobile-native-actions single">
          <button
            type="button"
            className="mobile-secondary-btn"
            disabled={!activeSessionId || sessionsBusy || !notesRootInput.trim()}
            onClick={() => {
              if (!activeSessionId) {
                return;
              }
              void setSessionNotesRoot(activeSessionId, notesRootInput);
            }}
          >
            Apply path
          </button>
        </div>
      </Group>
    </>
  );
}
