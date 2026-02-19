import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { useGitSync } from "../../contexts/GitSyncContext";
import { useSessions } from "../../contexts/SessionsContext";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Separator } from "../ui/separator";

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
      <h2 className="settings-detail-title">General</h2>
      <p className="settings-detail-text">Default behavior and session workspace.</p>
      <div className="settings-section-stack">
        <Card className="settings-card-block">
          <CardHeader className="settings-card-block-header">
            <CardTitle className="settings-card-block-title">Session</CardTitle>
            <CardDescription className="settings-card-block-description">
              Each session has its own local notes folder and Git remote.
            </CardDescription>
          </CardHeader>
          <CardContent className="settings-card-block-content">
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
                <span>Notes source folder</span>
                <code>{gitStatus?.notes_root || "-"}</code>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="settings-card-block">
          <CardHeader className="settings-card-block-header">
            <CardTitle className="settings-card-block-title">Session Working Directory</CardTitle>
            <CardDescription className="settings-card-block-description">
              Choose a local folder for notes in this session.
            </CardDescription>
          </CardHeader>
          <CardContent className="settings-card-block-content">
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
              <span className="settings-inline-help">
                Moves current session files and switches Git root to this absolute path.
              </span>
              {activeSessionNotesRoot ? <code>{activeSessionNotesRoot}</code> : null}
            </div>
            <Separator className="settings-card-separator" />
            <p className="settings-inline-help">
              Use the picker to avoid typos and ensure a valid absolute path.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
