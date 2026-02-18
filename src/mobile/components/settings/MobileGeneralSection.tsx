import { useTheme } from "../../../contexts/ThemeContext";
import { useSessions } from "../../../contexts/SessionsContext";
import { Group, ChoiceRow } from "./SettingsHelpers";

export function MobileGeneralSection() {
  const { notesListMode, setNotesListMode } = useTheme();
  const {
    sessions,
    activeSessionId,
    sessionsBusy,
    sessionsError,
    switchSession,
    createSession,
  } = useSessions();

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
