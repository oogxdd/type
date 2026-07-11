import { useCallback, useEffect, useMemo, useState } from "react";
import { formatRecordingStatus, formatUpdatedAt } from "@typenotes/shared/format";
import {
  selectSyncSettings,
  updateSyncSettings,
  useProfilesStore,
} from "@/features/profiles/state/profiles-store";
import { useRecordings } from "@/features/recording/hooks/recordings-context";
import { useAudioImport } from "@/features/recording/hooks/use-audio-import";
import { Button } from "@/shared/ui/button";
import type { RecordingListItem, TranscriptionProgress } from "@typenotes/shared/types";
import { WhisperEngineCard } from "./whisper-engine-card";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsErrorText,
  SettingsHelpText,
  SettingsInfoGrid,
  SettingsSection,
} from "../settings-ui";

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

function transcriptionPercent(progress: TranscriptionProgress): number {
  if (progress.total_seconds <= 0) return 0;
  return Math.min(
    100,
    Math.round((progress.processed_seconds / progress.total_seconds) * 100)
  );
}

function audioImportPercent(status: { processed: number; total: number }): number {
  if (status.total <= 0) return 0;
  return Math.min(100, Math.round((status.processed / status.total) * 100));
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

export function SettingsTranscriptionSection() {
  const syncSettings = useProfilesStore(selectSyncSettings);
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
    resolveAudioSrc,
  } = useRecordings();

  const {
    phase: audioImportPhase,
    status: audioImportStatus,
    error: audioImportError,
    pickAndImport,
    reset: resetAudioImport,
  } = useAudioImport({ onImported: () => void refreshRecordings() });

  const [busyPaths, setBusyPaths] = useState<Set<string>>(new Set());
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const [playingSrc, setPlayingSrc] = useState<string | null>(null);

  const handlePlay = useCallback(
    async (audioPath: string) => {
      setPlayingPath(audioPath);
      const src = await resolveAudioSrc(audioPath);
      setPlayingSrc(src);
    },
    [resolveAudioSrc]
  );

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

  useEffect(() => {
    void refreshRecordings();
  }, [refreshRecordings]);

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

  return (
    <SettingsSection
      title="Transcription"
      description="Transcribe your voice recordings locally with Whisper. Trigger one recording or all pending at once, and watch their status live."
    >
      <WhisperEngineCard
        whisperModel={syncSettings.whisperModel}
        onWhisperModelChange={(value) => updateSyncSettings({ whisperModel: value })}
      />

      <SettingsCard
        title="Import audio files"
        description="Bring in audio you already recorded elsewhere. Each file becomes its own note, dated to when the recording was actually made, and is queued for transcription automatically."
      >
        <SettingsActionRow>
          <Button
            type="button"
            size="sm"
            onClick={() => void pickAndImport()}
            disabled={audioImportPhase === "importing"}
          >
            {audioImportPhase === "importing"
              ? "Importing…"
              : "Choose audio file(s)…"}
          </Button>
          {audioImportPhase === "done" ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={resetAudioImport}
            >
              Import more
            </Button>
          ) : null}
        </SettingsActionRow>

        {audioImportStatus &&
        (audioImportPhase === "importing" || audioImportPhase === "done") ? (
          <>
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full rounded bg-primary transition-all"
                style={{ width: `${audioImportPercent(audioImportStatus)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {audioImportStatus.processed} / {audioImportStatus.total}
              </span>
              <span>{audioImportPercent(audioImportStatus)}%</span>
            </div>
            {audioImportPhase === "importing" && audioImportStatus.current ? (
              <SettingsHelpText className="truncate text-xs text-muted-foreground">
                {audioImportStatus.current}
              </SettingsHelpText>
            ) : null}
            <SettingsHelpText>
              Imported {audioImportStatus.imported}
              {audioImportStatus.failed > 0
                ? ` · ${audioImportStatus.failed} failed`
                : ""}
            </SettingsHelpText>
            {audioImportPhase === "done" && audioImportStatus.errors.length > 0 ? (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer text-destructive">
                  {audioImportStatus.failed} failed
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {audioImportStatus.errors.map((message, index) => (
                    <li key={index} className="break-all">
                      {message}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}
        {audioImportError ? (
          <SettingsErrorText>{audioImportError}</SettingsErrorText>
        ) : null}
      </SettingsCard>

      <SettingsCard>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <StatBadge label="Recordings" value={recordingsList.length} />
          <StatBadge label="Transcribing" value={counts.processing} />
          <StatBadge label="Queued" value={counts.queued} />
          <StatBadge label="Not transcribed" value={counts.pending} />
          <StatBadge label="Completed" value={counts.completed} />
          <StatBadge label="Failed" value={counts.failed} tone="destructive" />
        </div>

        {recordingsQueue?.current_recording ? (
          <div className="space-y-1.5">
            <SettingsHelpText>
              Now transcribing:{" "}
              <code className="text-[11px]">
                {recordingTitle(recordingsQueue.current_recording)}
              </code>
            </SettingsHelpText>
            {recordingsQueue.progress ? (
              <>
                <div className="h-2 w-full overflow-hidden rounded bg-muted">
                  <div
                    className="h-full rounded bg-primary transition-all"
                    style={{
                      width: `${transcriptionPercent(recordingsQueue.progress)}%`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {Math.round(recordingsQueue.progress.processed_seconds)}s /{" "}
                    {Math.round(recordingsQueue.progress.total_seconds)}s
                  </span>
                  <span>{transcriptionPercent(recordingsQueue.progress)}%</span>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
        {recordingStatusMessage ? (
          <SettingsHelpText>{recordingStatusMessage}</SettingsHelpText>
        ) : null}

        <SettingsActionRow>
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
        </SettingsActionRow>
        {recordingsError ? (
          <SettingsErrorText>{recordingsError}</SettingsErrorText>
        ) : null}
      </SettingsCard>

      <SettingsCard title="Recordings">
        <SettingsInfoGrid>
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
                  className="flex flex-col gap-2 border-b border-border/50 px-3 py-3 last:border-b-0"
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
                    <p className="break-words text-xs text-destructive">
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
                          onClick={() => void handlePlay(item.audio_path as string)}
                        >
                          {playingPath === item.audio_path ? "▶ Playing" : "Play"}
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
        </SettingsInfoGrid>
      </SettingsCard>

      {playingSrc ? (
        <audio
          className="w-full"
          controls
          autoPlay
          src={playingSrc}
          aria-label="Recording playback"
        />
      ) : null}
    </SettingsSection>
  );
}
