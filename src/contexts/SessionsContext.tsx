import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import * as api from "../data/notesApi";
import type { NotesSessionSnapshot, SessionSyncSettings } from "../types";
import {
  DEFAULT_SESSION_SYNC_SETTINGS,
  getSessionSyncSettings,
  readSessionSyncStore,
  writeSessionSyncStore,
} from "../utils/storage";

type SessionsContextValue = {
  sessionsSnapshot: NotesSessionSnapshot | null;
  sessionsBusy: boolean;
  sessionsError: string | null;
  sessions: NotesSessionSnapshot["sessions"];
  activeSessionId: string | null;
  activeSessionNotesRoot: string | null;
  syncSettings: SessionSyncSettings;
  updateSyncSettings: (patch: Partial<SessionSyncSettings>) => void;
  refreshSessions: () => Promise<NotesSessionSnapshot>;
  switchSession: (sessionId: string) => Promise<void>;
  createSession: () => Promise<void>;
  setSessionNotesRoot: (sessionId: string, notesRoot: string) => Promise<void>;
  flushSaveRef: React.RefObject<(() => Promise<void>) | null>;
};

const SessionsContext = createContext<SessionsContextValue | null>(null);

export function SessionsProvider({
  children,
  flushSaveRef,
}: {
  children: ReactNode;
  flushSaveRef: React.RefObject<(() => Promise<void>) | null>;
}) {
  const [sessionsSnapshot, setSessionsSnapshot] = useState<NotesSessionSnapshot | null>(null);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [syncSettings, setSyncSettings] = useState<SessionSyncSettings>(DEFAULT_SESSION_SYNC_SETTINGS);
  const [syncSettingsSessionId, setSyncSettingsSessionId] = useState<string | null>(null);

  const sessions = sessionsSnapshot?.sessions ?? [];
  const activeSessionId = sessionsSnapshot?.active_session_id ?? null;
  const activeSessionNotesRoot =
    sessions.find((session) => session.id === activeSessionId)?.notes_root ?? null;

  const refreshSessions = useCallback(async () => {
    const snapshot = await api.getSessions();
    setSessionsSnapshot(snapshot);
    return snapshot;
  }, []);

  const updateSyncSettings = useCallback((patch: Partial<SessionSyncSettings>) => {
    setSyncSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // Load sync settings when active session changes
  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    const settings = getSessionSyncSettings(activeSessionId);
    setSyncSettings(settings);
    setSyncSettingsSessionId(activeSessionId);
  }, [activeSessionId]);

  // Persist sync settings when they change
  useEffect(() => {
    if (!activeSessionId || syncSettingsSessionId !== activeSessionId) {
      return;
    }
    const store = readSessionSyncStore();
    store[activeSessionId] = syncSettings;
    writeSessionSyncStore(store);
  }, [activeSessionId, syncSettings, syncSettingsSessionId]);

  // Initial fetch
  useEffect(() => {
    void (async () => {
      setSessionsBusy(true);
      try {
        await refreshSessions();
        setSessionsError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSessionsError(message);
      } finally {
        setSessionsBusy(false);
      }
    })();
  }, [refreshSessions]);

  const switchSession = useCallback(
    async (sessionId: string) => {
      const normalizedId = sessionId.trim();
      if (!normalizedId || normalizedId === activeSessionId) {
        return;
      }
      setSessionsBusy(true);
      try {
        if (flushSaveRef.current) {
          await flushSaveRef.current();
        }
        const snapshot = await api.setActiveSession(normalizedId);
        setSessionsSnapshot(snapshot);
        setSessionsError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSessionsError(message);
      } finally {
        setSessionsBusy(false);
      }
    },
    [activeSessionId, flushSaveRef]
  );

  const createSession = useCallback(async () => {
    const existingNames = new Set(
      sessions.map((session) => session.name.trim().toLowerCase())
    );
    let index = 1;
    let name = "Session";
    while (existingNames.has(name.toLowerCase())) {
      index += 1;
      name = `Session ${index}`;
    }

    setSessionsBusy(true);
    try {
      if (flushSaveRef.current) {
        await flushSaveRef.current();
      }
      const snapshot = await api.createSession(name);
      setSessionsSnapshot(snapshot);
      setSessionsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSessionsError(message);
    } finally {
      setSessionsBusy(false);
    }
  }, [flushSaveRef, sessions]);

  const setSessionNotesRoot = useCallback(
    async (sessionId: string, notesRoot: string) => {
      const normalizedSessionId = sessionId.trim();
      const normalizedRoot = notesRoot.trim();
      if (!normalizedSessionId || !normalizedRoot) {
        return;
      }
      setSessionsBusy(true);
      try {
        if (flushSaveRef.current) {
          await flushSaveRef.current();
        }
        const snapshot = await api.setSessionNotesRoot(normalizedSessionId, normalizedRoot);
        setSessionsSnapshot(snapshot);
        setSessionsError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSessionsError(message);
      } finally {
        setSessionsBusy(false);
      }
    },
    [flushSaveRef]
  );

  return (
    <SessionsContext.Provider
      value={{
        sessionsSnapshot,
        sessionsBusy,
        sessionsError,
        sessions,
        activeSessionId,
        activeSessionNotesRoot,
        syncSettings,
        updateSyncSettings,
        refreshSessions,
        switchSession,
        createSession,
        setSessionNotesRoot,
        flushSaveRef,
      }}
    >
      {children}
    </SessionsContext.Provider>
  );
}

export function useSessions() {
  const context = useContext(SessionsContext);
  if (!context) {
    throw new Error("useSessions must be used within a SessionsProvider");
  }
  return context;
}
