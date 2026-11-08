// On-device transcription provider for transcription_mode: "native".
//
// Bridges expo-speech-recognition (SFSpeechRecognizer on iOS, SpeechRecognizer
// on Android) into the core's transcription queue as a RawTranscriptionProvider:
// the Rust queue worker calls back into `transcribe()` with the absolute path
// of the saved audio file, one job at a time.
//
// The module is require()d lazily so bundles without the native module (Expo
// Go, demo mode) still boot — attempting to queue then fails with a clear
// message instead of crashing at import time.

import type { RawTranscriptionProvider } from "@typenotes/mobile-core/raw-core";

type SpeechResultEvent = {
  isFinal: boolean;
  results: { transcript: string; confidence?: number }[];
};

type SpeechErrorEvent = { error: string; message?: string };

type Subscription = { remove: () => void };

type SpeechRecognitionApi = {
  ExpoSpeechRecognitionModule: {
    requestPermissionsAsync(): Promise<{ granted: boolean }>;
    start(options: Record<string, unknown>): void;
    abort(): void;
  };
  addSpeechRecognitionListener(
    event: "result" | "error" | "end",
    handler: (event: never) => void
  ): Subscription;
};

const TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000;

const loadModule = (): SpeechRecognitionApi => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-speech-recognition") as SpeechRecognitionApi;
  } catch {
    throw new Error(
      "Native speech recognition is not available in this build. " +
        "Rebuild the app with expo-speech-recognition installed, or pick a " +
        "different transcription mode in Settings."
    );
  }
};

const toFileUri = (path: string): string =>
  path.startsWith("file://") ? path : `file://${encodeURI(path)}`;

/** Run one file-based recognition pass; resolves with the full transcript. */
const recognizeFile = (
  api: SpeechRecognitionApi,
  audioPath: string,
  requiresOnDeviceRecognition: boolean
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const { ExpoSpeechRecognitionModule } = api;
    const finalSegments: string[] = [];
    let interim = "";
    const subscriptions: Subscription[] = [];

    const cleanup = () => {
      subscriptions.forEach((s) => s.remove());
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      cleanup();
      ExpoSpeechRecognitionModule.abort();
      reject(new Error("Speech recognition timed out."));
    }, TRANSCRIBE_TIMEOUT_MS);

    subscriptions.push(
      api.addSpeechRecognitionListener("result", ((event: SpeechResultEvent) => {
        const transcript = event.results[0]?.transcript ?? "";
        if (event.isFinal) {
          if (transcript.trim()) {
            finalSegments.push(transcript.trim());
          }
          interim = "";
        } else {
          interim = transcript;
        }
      }) as never)
    );
    subscriptions.push(
      api.addSpeechRecognitionListener("error", ((event: SpeechErrorEvent) => {
        cleanup();
        reject(
          new Error(event.message || `Speech recognition failed (${event.error}).`)
        );
      }) as never)
    );
    subscriptions.push(
      api.addSpeechRecognitionListener("end", (() => {
        cleanup();
        const transcript = [...finalSegments, interim.trim()]
          .filter(Boolean)
          .join(" ")
          .trim();
        if (transcript) {
          resolve(transcript);
        } else {
          reject(new Error("Speech recognition produced no transcript."));
        }
      }) as never)
    );

    ExpoSpeechRecognitionModule.start({
      interimResults: true,
      // Keep recognizing across pauses so the whole file is transcribed.
      continuous: true,
      addsPunctuation: true,
      requiresOnDeviceRecognition,
      audioSource: { uri: toFileUri(audioPath) },
    });
  });

/** True when the native module is linked into this build. */
export const isNativeTranscriptionAvailable = (): boolean => {
  try {
    loadModule();
    return true;
  } catch {
    return false;
  }
};

export const requestNativeTranscriptionPermission = async (): Promise<boolean> => {
  const api = loadModule();
  const { granted } = await api.ExpoSpeechRecognitionModule.requestPermissionsAsync();
  return granted;
};

export const nativeTranscriptionProvider: RawTranscriptionProvider = {
  id: () => "expo-speech-recognition",

  transcribe: async (audioPath: string): Promise<string> => {
    const api = loadModule();
    const { granted } = await api.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) {
      throw new Error(
        "Speech recognition permission was denied. Enable it in system settings."
      );
    }
    try {
      // Prefer fully on-device recognition (private, works offline)…
      return await recognizeFile(api, audioPath, true);
    } catch {
      // …but fall back to the system's default (possibly networked)
      // recognizer when no on-device model is installed for the locale.
      return recognizeFile(api, audioPath, false);
    }
  },
};
