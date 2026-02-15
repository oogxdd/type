import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../data/notesApi";

type UseAudioRecorderArgs = {
  onRecordingReady: (blob: Blob, mimeType: string) => Promise<void>;
};

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/ogg;codecs=opus",
  "audio/mpeg",
];

const pickMimeType = () => {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }
  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  return MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
};

const toErrorMessage = (error: unknown) => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      return "Microphone permission is required.";
    }
    if (error.name === "NotFoundError") {
      return "No microphone device was found.";
    }
    return error.message || "Audio recording failed.";
  }
  if (
    typeof error === "object" &&
    error &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const decodeBase64 = (raw: string): Uint8Array => {
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const formatElapsed = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

export const useAudioRecorder = ({ onRecordingReady }: UseAudioRecorderArgs) => {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("");
  const isRecordingRef = useRef(false);

  const [nativeSupported, setNativeSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordingStartedAtMs, setRecordingStartedAtMs] = useState<number | null>(null);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [nativeRecoveryNotice, setNativeRecoveryNotice] = useState<string | null>(null);

  const webSupported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);
  const isSupported = nativeSupported || webSupported;

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  const syncNativeCapabilities = useCallback(
    async (reason: "init" | "foreground") => {
      try {
        const caps = await api.nativeRecorderCapabilities();
        setNativeSupported(caps.supported);
        if (!caps.supported) {
          return;
        }

        if (!caps.recording) {
          setIsRecording(false);
          setRecordingStartedAtMs(null);
          setNativeRecoveryNotice(null);
          return;
        }

        if (reason === "foreground") {
          setNativeRecoveryNotice(
            isRecordingRef.current
              ? "Native recording is still active after return."
              : "Native recording resumed after return."
          );
        } else if (!isRecordingRef.current && reason === "init") {
          setNativeRecoveryNotice("Native recording resumed after return.");
        }
        setIsRecording(true);
        setClockNowMs(Date.now());
        setRecordingStartedAtMs(caps.started_ms ?? Date.now());
      } catch {
        setNativeSupported(false);
      }
    },
    []
  );

  useEffect(() => {
    void syncNativeCapabilities("init");
  }, [syncNativeCapabilities]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncNativeCapabilities("foreground");
      }
    };
    const handleWindowFocus = () => {
      void syncNativeCapabilities("foreground");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [syncNativeCapabilities]);

  useEffect(() => {
    if (!isRecording || !recordingStartedAtMs) {
      return;
    }
    setClockNowMs(Date.now());
    const timer = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isRecording, recordingStartedAtMs]);

  const saveBlob = useCallback(
    async (blob: Blob, mimeType: string) => {
      if (blob.size === 0) {
        setError("No audio captured. Try recording again.");
        return;
      }
      setIsFinalizing(true);
      try {
        await onRecordingReady(blob, mimeType || blob.type);
        setError(null);
      } catch (cause) {
        setError(toErrorMessage(cause));
      } finally {
        setIsFinalizing(false);
      }
    },
    [onRecordingReady]
  );

  const startWebRecording = useCallback(async () => {
    setError(null);
    chunksRef.current = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const chosenMimeType = pickMimeType();
    mimeTypeRef.current = chosenMimeType;
    const recorder = chosenMimeType
      ? new MediaRecorder(stream, { mimeType: chosenMimeType })
      : new MediaRecorder(stream);

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onerror = () => {
      setError("Audio recorder encountered an error.");
    };

    recorder.onstop = () => {
      recorderRef.current = null;
      setIsRecording(false);
      stopStream();

      const blobType = mimeTypeRef.current || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: blobType });
      chunksRef.current = [];
      void saveBlob(blob, mimeTypeRef.current || blob.type);
    };

    recorderRef.current = recorder;
    recorder.start(200);
    setIsRecording(true);
  }, [saveBlob, stopStream]);

  const stopRecording = useCallback(() => {
    if (nativeSupported) {
      if (!isRecording || isFinalizing) {
        return;
      }
      setIsFinalizing(true);
      void api
        .stopNativeAudioRecording()
        .then(async (payload) => {
          setIsRecording(false);
          setRecordingStartedAtMs(null);
          setNativeRecoveryNotice(null);
          const bytes = decodeBase64(payload.audio_base64);
          const mimeType = payload.mime_type || "audio/mp4";
          const blob = new Blob([bytes], { type: mimeType });
          if (blob.size === 0) {
            setError("No audio captured. Try recording again.");
            return;
          }
          await onRecordingReady(blob, mimeType);
          setError(null);
        })
        .catch((cause) => {
          setError(toErrorMessage(cause));
          void syncNativeCapabilities("foreground");
        })
        .finally(() => {
          setIsFinalizing(false);
        });
      return;
    }

    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return;
    }
    recorder.stop();
  }, [
    isFinalizing,
    isRecording,
    nativeSupported,
    onRecordingReady,
    syncNativeCapabilities,
  ]);

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      stopStream();
    };
  }, [stopStream]);

  const recordingElapsedMs =
    isRecording && recordingStartedAtMs
      ? Math.max(0, clockNowMs - recordingStartedAtMs)
      : null;
  const recordingElapsedLabel =
    recordingElapsedMs !== null ? formatElapsed(recordingElapsedMs) : null;

  return {
    isSupported,
    isRecording,
    isFinalizing,
    error,
    nativeRecoveryNotice,
    recordingElapsedLabel,
    startRecording: async () => {
      try {
        if (nativeSupported) {
          if (isRecording || isFinalizing) {
            return;
          }
          setError(null);
          await api.startNativeAudioRecording();
          setIsRecording(true);
          setClockNowMs(Date.now());
          setRecordingStartedAtMs(Date.now());
          setNativeRecoveryNotice(null);
          return;
        }
        if (!webSupported) {
          setError("This device does not support audio recording in-app.");
          return;
        }
        if (isRecording || isFinalizing) {
          return;
        }
        await startWebRecording();
      } catch (cause) {
        setError(toErrorMessage(cause));
        stopStream();
      }
    },
    stopRecording,
    clearError: () => setError(null),
  };
};
