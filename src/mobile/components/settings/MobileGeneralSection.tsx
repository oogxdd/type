import { useTheme } from "../../../contexts/ThemeContext";
import { useSessions } from "../../../contexts/SessionsContext";
import { Group, ChoiceRow } from "./SettingsHelpers";
import { useEffect, useMemo, useState } from "react";

export function MobileGeneralSection() {
  const { notesListMode, setNotesListMode } = useTheme();
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

      <Group title="Working Directory">
        <div className="mobile-native-row">
          <input
            type="text"
            value={notesRootInput}
            onChange={(event) => setNotesRootInput(event.target.value)}
            placeholder="/Users/you/Documents/type"
            disabled={!activeSessionId || sessionsBusy}
          />
        </div>
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
        {activeSessionNotesRoot ? <p className="mobile-native-note">{activeSessionNotesRoot}</p> : null}
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
  );
}
