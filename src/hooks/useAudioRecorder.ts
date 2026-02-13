import { useCallback, useEffect, useRef, useState } from "react";

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
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

export const useAudioRecorder = ({ onRecordingReady }: UseAudioRecorderArgs) => {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("");

  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSupported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return;
    }
    recorder.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      setError("This device does not support audio recording in-app.");
      return;
    }
    if (isRecording || isFinalizing) {
      return;
    }

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
      if (blob.size === 0) {
        setError("No audio captured. Try recording again.");
        return;
      }

      setIsFinalizing(true);
      void onRecordingReady(blob, mimeTypeRef.current || blob.type)
        .then(() => {
          setError(null);
        })
        .catch((cause) => {
          setError(toErrorMessage(cause));
        })
        .finally(() => {
          setIsFinalizing(false);
        });
    };

    recorderRef.current = recorder;
    recorder.start(200);
    setIsRecording(true);
  }, [isFinalizing, isRecording, isSupported, onRecordingReady, stopStream]);

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
        await startRecording();
      } catch (cause) {
        setError(toErrorMessage(cause));
        stopStream();
      }
    },
    stopRecording,
    clearError: () => setError(null),
  };
};
