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

export const useAudioRecorder = ({ onRecordingReady }: UseAudioRecorderArgs) => {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("");

  const [nativeSupported, setNativeSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    let mounted = true;
    void api
      .nativeRecorderCapabilities()
      .then((caps) => {
        if (!mounted) {
          return;
        }
        setNativeSupported(caps.supported);
        setIsRecording(caps.recording);
      })
      .catch(() => {
        if (!mounted) {
          return;
        }
        setNativeSupported(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

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
  }, [isFinalizing, isRecording, nativeSupported, onRecordingReady]);

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      stopStream();
    };
  }, [stopStream]);

  return {
    isSupported,
    isRecording,
    isFinalizing,
    error,
    startRecording: async () => {
      try {
        if (nativeSupported) {
          if (isRecording || isFinalizing) {
            return;
          }
          setError(null);
          await api.startNativeAudioRecording();
          setIsRecording(true);
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
