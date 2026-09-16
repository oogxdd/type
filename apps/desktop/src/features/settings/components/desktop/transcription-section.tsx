import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, CircleAlert, Clock3, FileAudio, Loader2, Play, RefreshCw, Search, Settings2 } from "lucide-react";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { useRecordings } from "@/features/recording/hooks/recordings-context";
import { useAudioImport } from "@/features/recording/hooks/use-audio-import";
import {
  recordingLabel, transcriptionState, transcriptionErrorSummary, transcriptionErrorDetails,
  type TranscriptionState,
} from "@/features/recording/lib/transcription-presentation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { ProfileSyncSettings } from "@typenotes/shared/types";
import { WhisperEngineCard } from "./whisper-engine-card";
import {
  SettingsActionRow, SettingsCard, SettingsErrorText, SettingsField,
  SettingsHelpText, SettingsSection, SettingsSelect,
} from "../settings-ui";

type Filter = "todo" | "all" | "completed" | "attention";
const STATE_LABELS: Record<TranscriptionState, string> = {
  processing: "Transcribing", queued: "Queued", waiting: "Awaiting audio",
  pending: "Ready", failed: "Needs attention", completed: "Completed", archived: "Archived",
};
const FILTERS: { id: Filter; label: string }[] = [
  { id: "todo", label: "To transcribe" },
  { id: "attention", label: "Needs attention" },
  { id: "completed", label: "Completed" },
  { id: "all", label: "All" },
];
function audioImportPercent(status: { processed: number; total: number }) {
  return status.total > 0 ? Math.min(100, Math.round(status.processed / status.total * 100)) : 0;
}

export function SettingsTranscriptionSection() {
  const { syncSettings, updateSyncSettings } = useProfiles();
  const {
    recordingsQueue, recordingsList, recordingsBusy, recordingsError,
    recordingStatusMessage, transcriptionQueueBusy, refreshRecordings,
    queueRecordingTranscriptions, retriggerTranscription, resolveAudioSrc,
  } = useRecordings();
  const {
    phase: audioImportPhase, status: audioImportStatus, error: audioImportError,
    pickAndImport, reset: resetAudioImport,
  } = useAudioImport({ onImported: () => void refreshRecordings() });
  const [filter, setFilter] = useState<Filter>("todo");
  const [search, setSearch] = useState("");
  const [busyPaths, setBusyPaths] = useState<Set<string>>(new Set());
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const [playingSrc, setPlayingSrc] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const useCloudTranscription = syncSettings.transcriptionProvider === "assemblyai";
  const missingAssemblyKey = useCloudTranscription && !syncSettings.assemblyAiApiKey.trim();
  const backendLabel = useCloudTranscription ? "AssemblyAI" : "Local Whisper";
  const openNote = (notePath: string) =>
    window.dispatchEvent(new CustomEvent("open-note", { detail: { notePath } }));

  // Continue watching while idle: notes and audio arrive independently.
  useEffect(() => {
    void refreshRecordings();
    const timer = window.setInterval(() => void refreshRecordings(), 2500);
    return () => window.clearInterval(timer);
  }, [refreshRecordings]);

  const handleTranscribe = useCallback(async (path: string) => {
    setBusyPaths((prev) => new Set(prev).add(path));
    try {
      await retriggerTranscription(path);
    } finally {
      setBusyPaths((prev) => { const next = new Set(prev); next.delete(path); return next; });
    }
  }, [retriggerTranscription]);

  const handlePlay = async (path: string) => {
    setPlaybackError(null);
    try {
      const src = await resolveAudioSrc(path);
      setPlayingPath(path);
      setPlayingSrc(src);
    } catch {
      setPlaybackError("Could not open this audio file. Refresh to check whether it is available.");
    }
  };

  const positions = useMemo(
    () => new Map((recordingsQueue?.pending ?? []).map((path, index) => [path, index + 1])),
    [recordingsQueue?.pending]
  );
  const matchesFilter = (state: TranscriptionState, target: Filter) =>
    target === "all" || (target === "completed" ? state === "completed"
      : target === "attention" ? state === "failed" || state === "waiting"
      : state !== "completed" && state !== "archived");
  const visible = recordingsList.filter((item) =>
    matchesFilter(transcriptionState(item), filter) &&
    item.note_path.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  ).sort((a, b) => {
    const rank = (path: string, active: boolean) => active ? 0 : positions.get(path) ?? positions.size + 1;
    return rank(a.note_path, a.is_processing) - rank(b.note_path, b.is_processing);
  });
  const current = recordingsQueue?.current_recording;
  const progress = recordingsQueue?.progress;
  const percent = progress && progress.total_seconds > 0
    ? Math.min(100, Math.max(0, Math.round(progress.processed_seconds / progress.total_seconds * 100))) : null;
  const waitingCount = recordingsList.filter((item) => transcriptionState(item) === "waiting").length;
  const readyCount = recordingsList.filter((item) => transcriptionState(item) === "pending").length;

  return (
    <SettingsSection title="Transcription" description="Your recordings, from audio to text.">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span>{backendLabel}{!useCloudTranscription ? ` · ${syncSettings.whisperModel}` : ""}</span>
          <span className="text-border">/</span>
          <span>Auto-refresh on</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void refreshRecordings()} disabled={recordingsBusy} aria-label="Refresh recordings">
            <RefreshCw size={14} className={recordingsBusy ? "animate-spin" : ""} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => void queueRecordingTranscriptions("manual")}
            disabled={transcriptionQueueBusy || missingAssemblyKey || readyCount === 0}>
            {transcriptionQueueBusy ? "Queueing…" : `Transcribe ready${readyCount ? ` (${readyCount})` : ""}`}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background">
            {current ? <Loader2 size={17} className="animate-spin text-primary" /> : <Check size={17} className="text-muted-foreground" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{current ? "Transcribing now" : "Queue is idle"}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {current ? [recordingLabel(current).title, recordingLabel(current).recordedAt].filter(Boolean).join(" · ")
                : readyCount ? `${readyCount} ready to transcribe. New recordings are queued automatically.`
                : waitingCount ? "Waiting for audio to arrive from your phone."
                : "New recordings will appear here automatically."}
            </p>
          </div>
          {current && percent !== null ? <span className="text-sm tabular-nums">{percent}%</span> : null}
        </div>
        {current ? (
          <div className="mt-3 space-y-2">
            <div role="progressbar" aria-label="Transcription progress" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={percent ?? undefined} className="h-1 overflow-hidden rounded-full bg-border">
              <div className={`h-full rounded-full bg-primary transition-all ${percent === null ? "animate-pulse" : ""}`}
                style={{ width: percent === null ? "30%" : `${percent}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {percent === null ? "Preparing audio and model…" : "Processing audio"}
              {positions.size > 0 ? ` · ${positions.size} next in queue` : ""}
            </p>
          </div>
        ) : null}
      </div>

      {waitingCount > 0 ? (
        <div className="flex items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
          <Clock3 size={15} className="mt-0.5 shrink-0" />
          <p>{waitingCount} {waitingCount === 1 ? "recording is" : "recordings are"} awaiting audio.
            Open Sync on your phone and keep it open until the audio transfer finishes.
            Notes can arrive before their audio.</p>
        </div>
      ) : null}
      {recordingsError || playbackError ? <SettingsErrorText>{recordingsError || playbackError}</SettingsErrorText> : null}

      <div className="overflow-hidden rounded-xl border border-border/60">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-3 pt-2">
          <div className="flex flex-wrap gap-3" role="group" aria-label="Filter recordings">
            {FILTERS.map(({ id, label }) => {
              const count = recordingsList.filter((item) => matchesFilter(transcriptionState(item), id)).length;
              return <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}
                className={`border-b-2 pb-2.5 pt-1 text-xs transition-colors ${filter === id ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {label} <span className="ml-1 tabular-nums opacity-50">{count}</span>
              </button>;
            })}
          </div>
          <div className="relative mb-2 w-40">
            <Search size={13} className="absolute left-2 top-2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)}
              aria-label="Search recordings" placeholder="Search" className="h-7 pl-7 text-xs" />
          </div>
        </div>
        <div className="max-h-[min(60vh,640px)] overflow-y-auto">
          {visible.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <FileAudio size={24} className="mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm">{search ? "No matching recordings" : filter === "todo" ? "Nothing waiting to be transcribed" : "No recordings here"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{search ? "Try another name or date." : "Record on your phone or import an audio file below."}</p>
            </div>
          ) : visible.map((item) => {
            const state = transcriptionState(item);
            const label = recordingLabel(item.note_path);
            const active = state === "processing" || state === "queued";
            const error = state === "failed" ? item.error : null;
            return (
              <div key={item.note_path} className={`border-b border-border/40 px-4 py-3 last:border-0 ${state === "processing" ? "bg-primary/5" : ""}`}>
                <div className="flex items-center gap-3">
                  <div className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                    {state === "processing" ? <Loader2 size={16} className="animate-spin text-primary" />
                      : positions.has(item.note_path) ? positions.get(item.note_path)
                      : state === "completed" ? <Check size={16} />
                      : state === "failed" ? <CircleAlert size={16} className="text-amber-600 dark:text-amber-400" />
                      : state === "waiting" ? <Clock3 size={16} /> : <FileAudio size={16} />}
                  </div>
                  <button type="button" title={item.note_path} onClick={() => openNote(item.note_path)}
                    className="min-w-0 flex-1 text-left hover:underline">
                    <p className="truncate text-sm font-medium">{label.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[label.recordedAt, item.folder_path].filter(Boolean).join(" · ")}
                    </p>
                  </button>
                  <span className={`shrink-0 text-[11px] ${state === "processing" ? "text-primary" : state === "failed" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                    {STATE_LABELS[state]}
                  </span>
                  {item.audio_path ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Play ${label.title}`}
                        onClick={() => void handlePlay(item.audio_path!)}>
                        <Play size={13} />
                      </Button>
                      {!active ? <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                        disabled={busyPaths.has(item.note_path) || missingAssemblyKey}
                        onClick={() => void handleTranscribe(item.note_path)}>
                        {busyPaths.has(item.note_path) ? "Queueing…" : state === "completed" ? "Redo" : state === "failed" ? "Retry" : "Transcribe"}
                      </Button> : null}
                    </div>
                  ) : null}
                </div>
                {error ? (
                  <div className="ml-8 mt-2 text-xs">
                    <p className="leading-relaxed text-muted-foreground">{transcriptionErrorSummary(error)}</p>
                    <details className="mt-1.5 text-muted-foreground/70">
                      <summary className="cursor-pointer text-[11px] hover:text-foreground">Technical details</summary>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-3 text-[11px]">
                        {transcriptionErrorDetails(error)}
                      </pre>
                    </details>
                  </div>
                ) : null}
                {playingSrc && playingPath === item.audio_path ? (
                  <audio controls autoPlay src={playingSrc} className="mt-3 h-8 w-full" aria-label="Recording playback"
                    onError={() => setPlaybackError("This audio cannot be played. The file may be damaged or unfinished.")} />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {recordingStatusMessage && !recordingStatusMessage.startsWith("Auto queue") ? (
        <p role="status" className="text-xs text-muted-foreground">{transcriptionErrorSummary(recordingStatusMessage)}</p>
      ) : null}

      <details className="group rounded-xl border border-border/60">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
          <Settings2 size={15} className="text-muted-foreground" />
          Engine & import
          <span className="ml-auto text-xs font-normal text-muted-foreground">{backendLabel}</span>
          <ChevronDown size={14} className="text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 border-t border-border/60 p-3">
      <SettingsCard
        title="Transcription engine"
        description="Which backend this desktop sends recordings to. Local Whisper runs offline and needs no key; AssemblyAI is faster on long backlogs but uploads your audio."
      >
        <SettingsField label="Provider">
          <SettingsSelect
            value={syncSettings.transcriptionProvider}
            onChange={(event) =>
              updateSyncSettings({
                transcriptionProvider: event.target
                  .value as ProfileSyncSettings["transcriptionProvider"],
              })
            }
          >
            <option value="whisper">Local Whisper</option>
            <option value="assemblyai">AssemblyAI (cloud)</option>
          </SettingsSelect>
        </SettingsField>

        {useCloudTranscription ? (
          <>
            <SettingsField label="AssemblyAI API key">
              <Input
                type="password"
                value={syncSettings.assemblyAiApiKey}
                onChange={(event) =>
                  updateSyncSettings({ assemblyAiApiKey: event.target.value })
                }
                placeholder="Paste AssemblyAI key"
                autoCapitalize="off"
                autoCorrect="off"
              />
            </SettingsField>
            {missingAssemblyKey ? (
              <SettingsErrorText>
                An API key is required before recordings can be queued.
              </SettingsErrorText>
            ) : null}
            <SettingsHelpText>
              The same key the mobile app uses. This setting is device-local — it
              does not sync to your phone.
            </SettingsHelpText>
          </>
        ) : null}
      </SettingsCard>

      {useCloudTranscription ? null : (
        <WhisperEngineCard
          whisperModel={syncSettings.whisperModel}
          onWhisperModelChange={(value) => updateSyncSettings({ whisperModel: value })}
        />
      )}

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

        </div>
      </details>
    </SettingsSection>
  );
}
