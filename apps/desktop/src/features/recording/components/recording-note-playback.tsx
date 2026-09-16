import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { NotePreview } from "@typenotes/shared/format";
import { useRecordings } from "../hooks/recordings-context";
import { useRecordingPlayback } from "../hooks/use-recording-playback";

const playbackStarted = "recording-inline-playback-started";
const clock = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "–:––";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Compact, lazy playback for a recording in the selected-notes divider. */
export function RecordingNotePlayback({ notePath, preview }: { notePath: string; preview?: NotePreview }) {
  const { recordingsList, resolveAudioSrc } = useRecordings();
  const recording = recordingsList.find((item) => item.note_path === notePath);
  const audioPath = recording?.audio_path ?? preview?.recordingAudioPath ?? null;
  const [attempt, setAttempt] = useState(0);
  const [requested, setRequested] = useState(false);
  const [wantPlaying, setWantPlaying] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(NaN);
  const [playError, setPlayError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // A large selection should not resolve/load every audio file up front.
  const { src, error } = useRecordingPlayback(notePath, requested ? audioPath : null, resolveAudioSrc, attempt);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    let cancelled = false;
    if (wantPlaying) {
      void audio.play().catch(() => {
        if (cancelled) return;
        setWantPlaying(false);
        setPlayError("Audio could not be played. Try again.");
      });
    } else audio.pause();
    return () => { cancelled = true; };
  }, [src, wantPlaying]);

  useEffect(() => {
    const pauseOther = (event: Event) => {
      if ((event as CustomEvent).detail === audioRef.current) return;
      setWantPlaying(false);
      audioRef.current?.pause();
    };
    window.addEventListener(playbackStarted, pauseOther);
    return () => window.removeEventListener(playbackStarted, pauseOther);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    return () => { audio?.pause(); };
  }, [src]);

  if (!preview?.isRecording && !recording) return null;
  const message = error ?? playError ?? (!audioPath ? "Audio is not available on this device." : null);
  return (
    <span className="recording-inline-player">
      <button
        type="button"
        className="recording-inline-toggle"
        aria-label={playing ? "Pause recording" : "Play recording"}
        title={message ?? (playing ? "Pause recording" : "Play recording")}
        disabled={!audioPath}
        onClick={(event) => {
          event.stopPropagation();
          setPlayError(null);
          setRequested(true);
          if (error) {
            setAttempt((value) => value + 1);
            setWantPlaying(true);
          } else setWantPlaying((value) => !value);
        }}
      >
        {playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
      </button>
      {playing ? <span className="recording-inline-time">{clock(position)} / {clock(duration)}</span> : null}
      {message ? <span className="sr-only" role="status">{message}</span> : null}
      {src ? <audio
        ref={audioRef}
        hidden
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onPlay={(event) => {
          setPlaying(true);
          window.dispatchEvent(new CustomEvent(playbackStarted, { detail: event.currentTarget }));
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setWantPlaying(false); }}
        onError={() => {
          setPlaying(false);
          setWantPlaying(false);
          setPlayError("Audio could not be played. Sync the recording and try again.");
        }}
      /> : null}
    </span>
  );
}
