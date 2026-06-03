import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { formatRecordingStatus, formatUpdatedAt } from "@/utils/format";
import { useProfiles } from "@/contexts/profiles-context";
import { useRecordings } from "@/contexts/recordings-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as api from "@/data/recordingsApi";
import type { RecordingListItem, WhisperStatusResult } from "@/types";

/** Normalised, display-ready status for a recording (queued/processing take
 *  precedence over the persisted note status). */
type DisplayStatus =
  | "completed"
  | "processing"
  | "queued"
  | "pending"
  | "failed"
  | "unknown";

function displayStatus(item: RecordingListItem): DisplayStatus {
  const raw = formatRecordingStatus(item).trim().toLowerCase();
  switch (raw) {
    case "completed":
    case "processing":
    case "queued":
    case "pending":
    case "failed":
      return raw;
    default:
      return "unknown";
  }
}

const STATUS_META: Record<
  DisplayStatus,
  { label: string; badge: string; dot: string }
> = {
  completed: {
    label: "Completed",
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  processing: {
    label: "Transcribing…",
    badge: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    dot: "bg-sky-500 animate-pulse",
  },
  queued: {
    label: "Queued",
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  pending: {
    label: "Not transcribed",
    badge: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
  failed: {
    label: "Failed",
    badge: "bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
  unknown: {
    label: "Unknown",
    badge: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
};

function StatusBadge({ status }: { status: DisplayStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function recordingTitle(notePath: string): string {
  const file = notePath.split("/").pop() ?? notePath;
  return file.replace(/\.md$/i, "");
}

export function SettingsTranscriptionSection() {
  const { syncSettings, updateSyncSettings } = useProfiles();
  const {
    recordingsQueue,
    recordingsList,
    recordingsBusy,
    recordingsError,
    recordingStatusMessage,
    transcriptionQueueBusy,
    refreshRecordings,
    queueRecordingTranscriptions,
    retriggerTranscription,
    playRecording,
    activeAudioPath,
    activeAudioSrc,
  } = useRecordings();

  const [whisperStatus, setWhisperStatus] = useState<WhisperStatusResult | null>(
    null
  );
  const [whisperSettingUp, setWhisperSettingUp] = useState(false);
  const [busyPaths, setBusyPaths] = useState<Set<string>>(new Set());

  // Navigate to the note itself. AppShell listens for this and leaves Settings.
  const openNote = useCallback((notePath: string) => {
    window.dispatchEvent(
      new CustomEvent("open-note", { detail: { notePath } })
    );
  }, []);

  const setPathBusy = useCallback((path: string, busy: boolean) => {
    setBusyPaths((prev) => {
      const next = new Set(prev);
      if (busy) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  // Lightweight readiness probe (does NOT provision — safe on mount).
  const probeWhisper = useCallback(async () => {
    try {
      setWhisperStatus(await api.checkWhisperStatus());
    } catch (error) {
      setWhisperStatus({
        available: false,
        python_found: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  // Explicit provisioning: installs the env and downloads the chosen model.
  const setUpWhisper = useCallback(async () => {
    setWhisperSettingUp(true);
    try {
      const status = await api.checkWhisperStatus(
        syncSettings.whisperModel.trim() || undefined,
        true
      );
      setWhisperStatus(status);
    } catch (error) {
      setWhisperStatus({
        available: false,
        python_found: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setWhisperSettingUp(false);
    }
  }, [syncSettings.whisperModel]);

  useEffect(() => {
    void refreshRecordings();
    void probeWhisper();
  }, [refreshRecordings, probeWhisper]);

  // Live polling while any job is queued or processing.
  const hasActiveWork =
    (recordingsQueue?.in_flight ?? 0) > 0 ||
    recordingsList.some((item) => item.is_queued || item.is_processing);

  useEffect(() => {
    if (!hasActiveWork) return;
    const id = window.setInterval(() => {
      void refreshRecordings();
    }, 2500);
    return () => window.clearInterval(id);
  }, [hasActiveWork, refreshRecordings]);

  const counts = useMemo(() => {
    const base: Record<DisplayStatus, number> = {
      completed: 0,
      processing: 0,
      queued: 0,
      pending: 0,
      failed: 0,
      unknown: 0,
    };
    for (const item of recordingsList) base[displayStatus(item)] += 1;
    return base;
  }, [recordingsList]);

  const failedItems = useMemo(
    () => recordingsList.filter((item) => displayStatus(item) === "failed"),
    [recordingsList]
  );

  const handleTranscribe = useCallback(
    async (notePath: string) => {
      setPathBusy(notePath, true);
      try {
        await retriggerTranscription(notePath);
      } finally {
        setPathBusy(notePath, false);
      }
    },
    [retriggerTranscription, setPathBusy]
  );

  const handleRetryFailed = useCallback(async () => {
    for (const item of failedItems) {
      setPathBusy(item.note_path, true);
      try {
        await retriggerTranscription(item.note_path);
      } finally {
        setPathBusy(item.note_path, false);
      }
    }
  }, [failedItems, retriggerTranscription, setPathBusy]);

  const envReady = whisperStatus?.available ?? false;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Transcription
        </h2>
        <p className="text-sm text-muted-foreground">
          Transcribe your voice recordings locally with Whisper. Trigger one
          recording or all pending at once, and watch their status live.
        </p>
      </div>

      {/* ── Engine / setup ─────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">
            Local engine (Whisper)
          </h3>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
              envReady
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                envReady ? "bg-emerald-500" : "bg-muted-foreground/50"
              }`}
            />
            {whisperStatus === null
              ? "Checking…"
              : envReady
                ? "Ready"
                : "Not set up"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          No API key needed — the app manages its own Python environment. The first
          setup downloads the engine and model and can take a few minutes.
        </p>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-foreground">Model / Path</span>
            <div className="flex flex-1 items-center gap-2 max-w-[300px]">
              <Input
                type="text"
                className="h-8 text-xs font-mono"
                value={syncSettings.whisperModel}
                onChange={(e) =>
                  updateSyncSettings({ whisperModel: e.target.value })
                }
                placeholder="large-v3"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck="false"
              />
              <Button
                variant="secondary"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={async () => {
                  try {
                    const selected = await open({
                      directory: true,
                      multiple: false,
                      title: "Select Whisper model directory",
                    });
                    if (selected && typeof selected === "string") {
                      updateSyncSettings({ whisperModel: selected });
                    }
                  } catch (err) {
                    console.error("Failed to open dialog", err);
                  }
                }}
              >
                Browse
              </Button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Model name (e.g. <code>large-v3</code>, <code>medium</code>,{" "}
            <code>small</code>) or an absolute path to a local model directory.
          </p>
        </div>

        {whisperStatus?.error ? (
          <p className="text-xs text-destructive break-words">
            {whisperStatus.error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => void setUpWhisper()}
            disabled={whisperSettingUp}
          >
            {whisperSettingUp
              ? "Setting up…"
              : envReady
                ? "Re-check / Download model"
                : "Set up / Download model"}
          </Button>
        </div>
      </section>

      {/* ── Overview + bulk actions ────────────────────────────────────── */}
      <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <StatBadge label="Recordings" value={recordingsList.length} />
          <StatBadge label="Transcribing" value={counts.processing} />
          <StatBadge label="Queued" value={counts.queued} />
          <StatBadge label="Not transcribed" value={counts.pending} />
          <StatBadge label="Completed" value={counts.completed} />
          <StatBadge label="Failed" value={counts.failed} tone="destructive" />
        </div>

        {recordingsQueue?.current_recording ? (
          <p className="text-xs text-muted-foreground">
            Now transcribing:{" "}
            <code className="text-[11px]">
              {recordingTitle(recordingsQueue.current_recording)}
            </code>
          </p>
        ) : null}
        {recordingStatusMessage ? (
          <p className="text-xs text-muted-foreground">{recordingStatusMessage}</p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            type="button"
            onClick={() => void queueRecordingTranscriptions("manual")}
            disabled={transcriptionQueueBusy}
          >
            {transcriptionQueueBusy ? "Queuing…" : "Transcribe all pending"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => void refreshRecordings()}
            disabled={recordingsBusy}
          >
            {recordingsBusy ? "Refreshing…" : "Refresh"}
          </Button>
          {failedItems.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void handleRetryFailed()}
            >
              Retry failed ({failedItems.length})
            </Button>
          ) : null}
        </div>
        {recordingsError ? (
          <p className="text-xs text-destructive">{recordingsError}</p>
        ) : null}
      </section>

      {/* ── Per-recording list ─────────────────────────────────────────── */}
      <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
        <h3 className="text-sm font-semibold text-foreground">Recordings</h3>
        <div className="overflow-hidden rounded-md border border-border/70">
          {recordingsList.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No recordings yet. Record some audio and it will show up here.
            </div>
          ) : (
            recordingsList.map((item) => {
              const status = displayStatus(item);
              const isActive = item.is_queued || item.is_processing;
              const rowBusy = busyPaths.has(item.note_path) || isActive;
              const actionLabel = item.is_processing
                ? "Transcribing…"
                : item.is_queued
                  ? "Queued…"
                  : status === "completed"
                    ? "Retranscribe"
                    : "Transcribe";
              return (
                <div
                  key={item.note_path}
                  className="flex flex-col gap-2 border-b border-border/70 px-3 py-3 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => openNote(item.note_path)}
                      title="Open note"
                      className="group min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-sm font-medium text-foreground group-hover:underline">
                        {recordingTitle(item.note_path)}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {item.folder_path || item.note_path}
                      </div>
                    </button>
                    <StatusBadge status={status} />
                  </div>

                  {item.error ? (
                    <p className="text-xs text-destructive break-words">
                      {item.error}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      Updated {formatUpdatedAt(item.updated_ms)}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      {item.audio_path ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            void playRecording(item.audio_path as string)
                          }
                        >
                          {activeAudioPath === item.audio_path
                            ? "▶ Playing"
                            : "Play"}
                        </Button>
                      ) : null}
                      <Button
                        variant={status === "failed" ? "destructive" : "secondary"}
                        size="sm"
                        type="button"
                        className="h-7 px-2 text-xs"
                        onClick={() => void handleTranscribe(item.note_path)}
                        disabled={rowBusy || !item.audio_path}
                      >
                        {actionLabel}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {activeAudioSrc ? (
        <audio
          className="w-full"
          controls
          autoPlay
          src={activeAudioSrc}
          aria-label="Recording playback"
        />
      ) : null}
    </div>
  );
}

function StatBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "destructive";
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className={`text-base font-semibold tabular-nums ${
          tone === "destructive" && value > 0
            ? "text-destructive"
            : "text-foreground"
        }`}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
