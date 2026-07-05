import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "../api/handwriting-api";
import type {
  HandwritingOcrListItem,
  HandwritingOcrQueueSnapshot,
} from "@/shared/types";
import { FEED_FOLDER_PATH } from "@/shared/constants";
import { toBase64 } from "@/shared/lib/notes";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { useAutoQueueLoop } from "@/features/processing/hooks/use-auto-queue-loop";
import { useProcessingQueue } from "@/features/processing/hooks/use-processing-queue";
import { jobListSignature } from "@/shared/lib/jobs";
import type { LayoutMode } from "@/mobile/navigation";
import { getErrorMessage } from "@/shared/lib/errors";

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
  layoutMode: LayoutMode;
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
  const queueBusyRef = useRef(false);

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

  const loadHandwritingSnapshot = useCallback(async () => {
    const snapshot = await api.listHandwritingOcrJobs();
    return {
      queue: snapshot.queue,
      items: snapshot.jobs,
    };
  }, []);

  const {
    queue: handwritingQueue,
    items: handwritingJobs,
    busy: handwritingBusy,
    error: handwritingError,
    refresh: refreshHandwritingJobs,
  } = useProcessingQueue<HandwritingOcrQueueSnapshot, HandwritingOcrListItem>({
    loadSnapshot: loadHandwritingSnapshot,
    getSignature: jobListSignature,
    invalidateEventName: "note-previews-invalidated",
    refreshOnMount: layoutMode !== "phone",
  });

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
        const message = getErrorMessage(error);
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
        const message = getErrorMessage(error);
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

  const autoQueueConfig = getProviderConfig();
  const autoQueueHandwriting = useCallback(
    () => queueHandwritingOcr("auto"),
    [queueHandwritingOcr]
  );
  useAutoQueueLoop({
    enabled:
      shouldAutoQueueHandwriting &&
      autoQueueConfig.apiKey.length > 0 &&
      autoQueueConfig.model.length > 0,
    delayMs: layoutMode === "phone" ? 3000 : 0,
    onTick: autoQueueHandwriting,
  });

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
