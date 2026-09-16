import { useEffect, useState } from "react";

type Playback = { key: string; src: string | null; error: string | null };

/** Tie a resolved URL to its note, so a failed load can never reuse another recording. */
export function useRecordingPlayback(
  notePath: string | null,
  audioPath: string | null,
  resolve: (path: string) => Promise<string>
) {
  const key = JSON.stringify([notePath, audioPath]);
  const [playback, setPlayback] = useState<Playback | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPlayback(null);
    if (notePath && audioPath) {
      void resolve(audioPath).then(
        (src) => { if (!cancelled) setPlayback({ key, src, error: null }); },
        () => {
          if (!cancelled) setPlayback({
            key, src: null,
            error: "Audio is not available on this device. Sync from your phone to transfer it.",
          });
        }
      );
    }
    return () => { cancelled = true; };
  }, [notePath, audioPath, key, resolve]);
  return playback?.key === key ? playback : { src: null, error: null };
}
