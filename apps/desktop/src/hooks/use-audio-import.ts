import { useCallback, useEffect, useRef, useState } from "react";
import {
  selectSyncSettings,
  useProfilesStore,
} from "@/state/profiles-store";
import {
  getAudioImportStatus,
  importAudioFiles,
  pickAudioFiles,
  type AudioImportState,
} from "@/api/recordings-api";

/**
 * idle      → nothing picked
 * importing → backend running; polling progress
 * done      → finished (see `status`)
 * error     → picker/start failed or import aborted
 */
export type AudioImportPhase = "idle" | "importing" | "done" | "error";

const POLL_INTERVAL_MS = 250;

/**
 * Drives the bulk audio-file import flow: one native picker (single or
 * multi-select) immediately followed by import with polled progress — no
 * separate "start" step, since there's no ambiguity to preview (one note per
 * file). Progress is polled to match the recordings/handwriting/Apple-import
 * queue pattern. `onImported` fires once on successful completion so the
 * caller can refresh the recordings list.
 */
export function useAudioImport({ onImported }: { onImported?: () => void } = {}) {
  const syncSettings = useProfilesStore(selectSyncSettings);

  const [phase, setPhase] = useState<AudioImportPhase>("idle");
  const [status, setStatus] = useState<AudioImportState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);
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
        const next = await getAudioImportStatus();
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
  // user closed and reopened Settings mid-import).
  useEffect(() => {
    let cancelled = false;
    void getAudioImportStatus()
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

  const pickAndImport = useCallback(async () => {
    setError(null);
    let selected: string[];
    try {
      selected = await pickAudioFiles();
    } catch (pickError) {
      setError(String(pickError));
      setPhase("error");
      return;
    }
    if (selected.length === 0) return;

    setStatus(null);
    setPhase("importing");
    try {
      await importAudioFiles({
        source_paths: selected,
        file_name_format: syncSettings.noteFileNameFormat,
      });
    } catch (startError) {
      setError(String(startError));
      setPhase("error");
      return;
    }
    beginPolling();
  }, [beginPolling, syncSettings.noteFileNameFormat]);

  const reset = useCallback(() => {
    stopPolling();
    setPhase("idle");
    setStatus(null);
    setError(null);
  }, [stopPolling]);

  return { phase, status, error, pickAndImport, reset };
}
