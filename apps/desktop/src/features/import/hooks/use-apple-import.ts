import { useCallback, useEffect, useRef, useState } from "react";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import {
  chooseAppleNotesFolder,
  getAppleImportStatus,
  scanAppleNotesFolder,
  startAppleNotesImport,
  type AppleImportMode,
  type AppleImportScan,
  type AppleImportState,
} from "@/features/import/api/import-api";

/**
 * idle      → nothing chosen
 * scanning  → previewing the picked folder
 * ready     → preview shown, awaiting mode/confirm
 * importing → backend running; polling progress
 * done      → finished (see `status`)
 * error     → scan failed or import aborted
 */
export type ImportPhase = "idle" | "scanning" | "ready" | "importing" | "done" | "error";

const POLL_INTERVAL_MS = 250;

/**
 * Drives the Apple Notes import flow: folder pick → scan preview → import with
 * polled progress. Progress is polled (not evented) to match the recordings /
 * handwriting queue pattern. `onImported` fires once on successful completion so
 * the caller can refresh the tree.
 */
export function useAppleImport({ onImported }: { onImported?: () => void } = {}) {
  const { syncSettings } = useProfiles();

  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [sourcePath, setSourcePath] = useState("");
  const [scan, setScan] = useState<AppleImportScan | null>(null);
  const [mode, setMode] = useState<AppleImportMode>("preserve");
  const [targetFolder, setTargetFolder] = useState("");
  const [status, setStatus] = useState<AppleImportState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);
  // Keep the latest onImported without re-creating the polling callback.
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const beginPolling = useCallback(() => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const next = await getAppleImportStatus();
        setStatus(next);
        if (next.done) {
          stopPolling();
          if (next.error) {
            setError(next.error);
            setPhase("error");
          } else {
            setPhase("done");
            onImportedRef.current?.();
          }
        }
      } catch (pollError) {
        stopPolling();
        setError(String(pollError));
        setPhase("error");
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling]);

  // Resume polling if an import is already running when this mounts (e.g. the
  // user closed and reopened the settings panel mid-import). Also tears polling
  // down on unmount — the backend import keeps running regardless.
  useEffect(() => {
    let cancelled = false;
    void getAppleImportStatus()
      .then((current) => {
        if (cancelled || !current.running) return;
        setStatus(current);
        setPhase("importing");
        beginPolling();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [beginPolling, stopPolling]);

  const pickFolder = useCallback(async () => {
    setError(null);
    let selected: string | null;
    try {
      selected = await chooseAppleNotesFolder(sourcePath || undefined);
    } catch (pickError) {
      setError(String(pickError));
      return;
    }
    if (!selected) return;
    setSourcePath(selected);
    setScan(null);
    setStatus(null);
    setPhase("scanning");
    try {
      const result = await scanAppleNotesFolder(selected);
      setScan(result);
      setTargetFolder(result.source_name);
      setPhase("ready");
    } catch (scanError) {
      setError(String(scanError));
      setPhase("error");
    }
  }, [sourcePath]);

  const startImport = useCallback(async () => {
    if (!sourcePath) return;
    setError(null);
    setStatus(null);
    setPhase("importing");
    try {
      await startAppleNotesImport({
        source_path: sourcePath,
        mode,
        target_folder:
          mode === "preserve"
            ? targetFolder.trim() || scan?.source_name || undefined
            : undefined,
        file_name_format: syncSettings.noteFileNameFormat,
      });
    } catch (startError) {
      setError(String(startError));
      setPhase("error");
      return;
    }
    beginPolling();
  }, [
    beginPolling,
    mode,
    scan?.source_name,
    sourcePath,
    syncSettings.noteFileNameFormat,
    targetFolder,
  ]);

  const reset = useCallback(() => {
    stopPolling();
    setPhase("idle");
    setSourcePath("");
    setScan(null);
    setStatus(null);
    setError(null);
    setTargetFolder("");
  }, [stopPolling]);

  return {
    phase,
    sourcePath,
    scan,
    mode,
    setMode,
    targetFolder,
    setTargetFolder,
    status,
    error,
    pickFolder,
    startImport,
    reset,
  };
}
