import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { useGitSync } from "../../contexts/GitSyncContext";
import { useSessions } from "../../contexts/SessionsContext";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function SettingsGeneralSection() {
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
  const { gitStatus } = useGitSync();
  const [notesRootInput, setNotesRootInput] = useState("");

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );

  useEffect(() => {
    setNotesRootInput(activeSession?.notes_root ?? "");
  }, [activeSession?.notes_root]);

  const chooseWorkingDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: notesRootInput || activeSessionNotesRoot || undefined,
        title: "Select session working directory",
      });
      if (typeof selected === "string" && selected.trim()) {
        setNotesRootInput(selected);
      }
    } catch (error) {
      console.error("Failed to pick working directory", error);
    }
  };

  return (
    <>
      <div className="settings-detail-hero">
        <h2 className="settings-detail-title">General</h2>
        <p className="settings-detail-text">Session and notes folder.</p>
      </div>
      <div className="settings-section-stack">
        <section className="settings-group">
          <h3 className="settings-group-title">Session</h3>
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
          </label>
          {sessionsError ? (
            <p className="settings-warning-text settings-inline-warning">{sessionsError}</p>
          ) : null}
          <div className="settings-info-grid">
            <div className="settings-info-row">
              <span>Notes root</span>
              <code>{gitStatus?.notes_root || "-"}</code>
            </div>
          </div>
        </section>

        <section className="settings-group">
          <h3 className="settings-group-title">Folder path</h3>
          <div className="settings-control">
            <Label htmlFor="session-working-directory">Folder path</Label>
            <div className="settings-inline-row">
              <Input
                id="session-working-directory"
                type="text"
                value={notesRootInput}
                onChange={(event) => setNotesRootInput(event.target.value)}
                placeholder="/Users/you/Documents/type"
                disabled={!activeSessionId || sessionsBusy}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!activeSessionId || sessionsBusy}
                onClick={() => void chooseWorkingDirectory()}
              >
                Choose folder
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!activeSessionId || sessionsBusy || !notesRootInput.trim()}
                onClick={() => {
                  if (!activeSessionId) {
                    return;
                  }
                  void setSessionNotesRoot(activeSessionId, notesRootInput);
                }}
              >
                Apply
              </Button>
            </div>
            <span className="settings-inline-help">Must be an absolute path.</span>
            {activeSessionNotesRoot ? <code>{activeSessionNotesRoot}</code> : null}
          </div>
        </section>
      </div>
    </>
  );
}
