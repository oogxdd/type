import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "../data/handwritingApi";
import type {
  HandwritingOcrListItem,
  HandwritingOcrQueueSnapshot,
} from "../types";
import { FEED_FOLDER_PATH } from "../constants";
import { toBase64 } from "../utils/notes";
import { useProfiles } from "./ProfilesContext";

const handwritingPreviewSignature = (items: HandwritingOcrListItem[]) =>
  items
    .map((item) =>
      [
        item.note_path,
        item.status,
        item.updated_ms ?? "",
        item.error ?? "",
        item.is_queued ? "1" : "0",
        item.is_processing ? "1" : "0",
      ].join("|")
    )
    .sort()
    .join("||");

type HandwritingContextValue = {
  handwritingImportBusy: boolean;
  handwritingStatusMessage: string | null;
  handwritingQueueBusy: boolean;
  handwritingQueue: HandwritingOcrQueueSnapshot | null;
  handwritingJobs: HandwritingOcrListItem[];
  handwritingBusy: boolean;
  handwritingError: string | null;
  importHandwritingFile: (
    file: File,
    preferredFolderPath?: string | null
  ) => Promise<void>;
  refreshHandwritingJobs: () => Promise<void>;
  queueHandwritingOcr: (trigger?: "manual" | "auto") => Promise<void>;
  shouldAutoQueueHandwriting: boolean;
};

const HandwritingContext = createContext<HandwritingContextValue | null>(null);

export function HandwritingProvider({
  children,
  activeFolder,
  layoutMode,
  onHandwritingComplete,
}: {
  children: ReactNode;
  activeFolder: string;
  layoutMode: string;
  onHandwritingComplete: (result: {
    folder_path: string;
    note_path: string;
    attachment_path: string;
  }) => Promise<void>;
}) {
  const { syncSettings } = useProfiles();
  const [handwritingImportBusy, setHandwritingImportBusy] = useState(false);
  const [handwritingStatusMessage, setHandwritingStatusMessage] = useState<string | null>(null);
  const [handwritingQueueBusy, setHandwritingQueueBusy] = useState(false);
  const [handwritingQueue, setHandwritingQueue] = useState<HandwritingOcrQueueSnapshot | null>(
    null
  );
  const [handwritingJobs, setHandwritingJobs] = useState<HandwritingOcrListItem[]>([]);
  const [handwritingBusy, setHandwritingBusy] = useState(false);
  const [handwritingError, setHandwritingError] = useState<string | null>(null);
  const queueBusyRef = useRef(false);
  const signatureRef = useRef("");

  const shouldAutoQueueHandwriting =
    layoutMode === "desktop" || syncSettings.mobileAutoHandwritingOcrEnabled;

  const resolveTargetFolder = useCallback(
    (preferredFolderPath?: string | null) => {
      const preferred = preferredFolderPath?.trim();
      if (preferred) {
        return preferred;
      }
      const active = activeFolder.trim();
      return active || FEED_FOLDER_PATH;
    },
    [activeFolder]
  );

  const getProviderConfig = useCallback(() => {
    if (syncSettings.handwritingOcrProvider === "huggingface") {
      return {
        provider: "huggingface" as const,
        apiKey: syncSettings.huggingFaceApiKey.trim(),
        model: syncSettings.huggingFaceModel.trim(),
      };
    }
    return {
      provider: "openai" as const,
      apiKey: syncSettings.openAiApiKey.trim(),
      model: syncSettings.openAiModel.trim(),
    };
  }, [
    syncSettings.handwritingOcrProvider,
    syncSettings.huggingFaceApiKey,
    syncSettings.huggingFaceModel,
    syncSettings.openAiApiKey,
    syncSettings.openAiModel,
  ]);

  const refreshHandwritingJobs = useCallback(async () => {
    setHandwritingBusy(true);
    try {
      const snapshot = await api.listHandwritingOcrJobs();
      setHandwritingQueue(snapshot.queue);
      setHandwritingJobs(snapshot.jobs);
      const nextSignature = handwritingPreviewSignature(snapshot.jobs);
      if (signatureRef.current !== nextSignature) {
        signatureRef.current = nextSignature;
        window.dispatchEvent(new CustomEvent("note-previews-invalidated"));
      }
      setHandwritingError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHandwritingError(message);
    } finally {
      setHandwritingBusy(false);
    }
  }, []);

  const queueHandwritingOcr = useCallback(
    async (trigger: "manual" | "auto" = "manual") => {
      if (queueBusyRef.current) {
        return;
      }
      const config = getProviderConfig();
      if (!config.apiKey) {
        if (trigger === "manual") {
          setHandwritingStatusMessage("OCR API key is required.");
        }
        return;
      }
      if (!config.model) {
        if (trigger === "manual") {
          setHandwritingStatusMessage("OCR model is required.");
        }
        return;
      }

      queueBusyRef.current = true;
      setHandwritingQueueBusy(true);
      try {
        const result = await api.queueHandwritingOcr(
          config.provider,
          config.apiKey,
          config.model
        );
        const label =
          trigger === "manual"
            ? `Scanned ${result.scanned}, queued ${result.queued}, in-flight ${result.in_flight}.`
            : `Auto queue: scanned ${result.scanned}, queued ${result.queued}.`;
        setHandwritingStatusMessage(label);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setHandwritingStatusMessage(message);
      } finally {
        queueBusyRef.current = false;
        setHandwritingQueueBusy(false);
        void refreshHandwritingJobs();
      }
    },
    [getProviderConfig, refreshHandwritingJobs]
  );

  const importHandwritingFile = useCallback(
    async (file: File, preferredFolderPath?: string | null) => {
      setHandwritingImportBusy(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await api.saveHandwritingAttachment(
          toBase64(bytes),
          file.type || undefined,
          file.name || undefined,
          resolveTargetFolder(preferredFolderPath),
          syncSettings.noteFileNameFormat
        );
        await onHandwritingComplete(result);
        setHandwritingStatusMessage(`Saved ${result.note_path}.`);
        void refreshHandwritingJobs();
        if (shouldAutoQueueHandwriting) {
          await queueHandwritingOcr("auto");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setHandwritingStatusMessage(message);
        throw error;
      } finally {
        setHandwritingImportBusy(false);
      }
    },
    [
      onHandwritingComplete,
      queueHandwritingOcr,
      refreshHandwritingJobs,
      resolveTargetFolder,
      syncSettings.noteFileNameFormat,
      shouldAutoQueueHandwriting,
    ]
  );

  useEffect(() => {
    if (layoutMode === "phone") {
      return;
    }
    void refreshHandwritingJobs();
  }, [layoutMode, refreshHandwritingJobs]);

  useEffect(() => {
    const config = getProviderConfig();
    if (!shouldAutoQueueHandwriting || !config.apiKey || !config.model) {
      return;
    }
    let intervalId: number | null = null;
    const startAutoQueue = () => {
      void queueHandwritingOcr("auto");
      intervalId = window.setInterval(() => {
        void queueHandwritingOcr("auto");
      }, 15000);
    };
    const delayMs = layoutMode === "phone" ? 3000 : 0;
    const startTimer = window.setTimeout(startAutoQueue, delayMs);
    return () => {
      window.clearTimeout(startTimer);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [getProviderConfig, layoutMode, queueHandwritingOcr, shouldAutoQueueHandwriting]);

  return (
    <HandwritingContext.Provider
      value={{
        handwritingImportBusy,
        handwritingStatusMessage,
        handwritingQueueBusy,
        handwritingQueue,
        handwritingJobs,
        handwritingBusy,
        handwritingError,
        importHandwritingFile,
        refreshHandwritingJobs,
        queueHandwritingOcr,
        shouldAutoQueueHandwriting,
      }}
    >
      {children}
    </HandwritingContext.Provider>
  );
}

export function useHandwriting() {
  const context = useContext(HandwritingContext);
  if (!context) {
    throw new Error("useHandwriting must be used within a HandwritingProvider");
  }
  return context;
}
