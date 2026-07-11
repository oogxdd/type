// Handwriting domain store: image-attachment import and the OCR queue.
// Mirrors the recordings store: plain module actions over a zustand store,
// with a self-gating auto-queue loop armed once at boot.
import { create } from "zustand";

import * as api from "@/api/handwriting-api";
import { toBase64 } from "@/lib/browser";
import { invalidateNotePreviews } from "@/state/note-previews";
import { completeCapture } from "@/state/notes-actions";
import {
  selectActiveProfileId,
  selectSyncSettings,
  useProfilesStore,
} from "@/state/profiles-store";
import { selectIsLocked, useSecurityStore } from "@/state/security-store";
import { useSelection } from "@/state/selection-store";
import { FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import { getErrorMessage } from "@typenotes/shared/errors";
import { jobListSignature } from "@typenotes/shared/jobs";
import type {
  HandwritingOcrListItem,
  HandwritingOcrQueueSnapshot,
} from "@typenotes/shared/types";

type HandwritingState = {
  importBusy: boolean;
  statusMessage: string | null;
  queueBusy: boolean;
  queue: HandwritingOcrQueueSnapshot | null;
  jobs: HandwritingOcrListItem[];
  listBusy: boolean;
  listError: string | null;
};

export const useHandwritingStore = create<HandwritingState>(() => ({
  importBusy: false,
  statusMessage: null,
  queueBusy: false,
  queue: null,
  jobs: [],
  listBusy: false,
  listError: null,
}));

const getProviderConfig = () => {
  const settings = selectSyncSettings(useProfilesStore.getState());
  if (settings.handwritingOcrProvider === "huggingface") {
    return {
      provider: "huggingface" as const,
      apiKey: settings.huggingFaceApiKey.trim(),
      model: settings.huggingFaceModel.trim(),
    };
  }
  return {
    provider: "openai" as const,
    apiKey: settings.openAiApiKey.trim(),
    model: settings.openAiModel.trim(),
  };
};

let queueInFlight = false;
let listSignature = "";

export async function refreshHandwritingJobs() {
  useHandwritingStore.setState({ listBusy: true });
  try {
    const snapshot = await api.listHandwritingOcrJobs();
    useHandwritingStore.setState({
      queue: snapshot.queue,
      jobs: snapshot.jobs,
      listError: null,
    });
    const nextSignature = jobListSignature(snapshot.jobs);
    if (listSignature !== nextSignature) {
      listSignature = nextSignature;
      // A finished OCR pass rewrites its note body on disk.
      invalidateNotePreviews();
    }
  } catch (error) {
    useHandwritingStore.setState({ listError: getErrorMessage(error) });
  } finally {
    useHandwritingStore.setState({ listBusy: false });
  }
}

export async function queueHandwritingOcr(trigger: "manual" | "auto" = "manual") {
  if (queueInFlight) {
    return;
  }
  const config = getProviderConfig();
  if (!config.apiKey) {
    if (trigger === "manual") {
      useHandwritingStore.setState({ statusMessage: "OCR API key is required." });
    }
    return;
  }
  if (!config.model) {
    if (trigger === "manual") {
      useHandwritingStore.setState({ statusMessage: "OCR model is required." });
    }
    return;
  }

  queueInFlight = true;
  useHandwritingStore.setState({ queueBusy: true });
  try {
    const result = await api.queueHandwritingOcr(
      config.provider,
      config.apiKey,
      config.model
    );
    const statusMessage =
      trigger === "manual"
        ? `Scanned ${result.scanned}, queued ${result.queued}, in-flight ${result.in_flight}.`
        : `Auto queue: scanned ${result.scanned}, queued ${result.queued}.`;
    useHandwritingStore.setState({ statusMessage });
  } catch (error) {
    useHandwritingStore.setState({ statusMessage: getErrorMessage(error) });
  } finally {
    queueInFlight = false;
    useHandwritingStore.setState({ queueBusy: false });
    void refreshHandwritingJobs();
  }
}

export async function importHandwritingFile(
  file: File,
  preferredFolderPath?: string | null
) {
  useHandwritingStore.setState({ importBusy: true });
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const targetFolder =
      preferredFolderPath?.trim() ||
      useSelection.getState().activeFolder.trim() ||
      FEED_FOLDER_PATH;
    const { noteFileNameFormat } = selectSyncSettings(useProfilesStore.getState());
    const result = await api.saveHandwritingAttachment(
      toBase64(bytes),
      file.type || undefined,
      file.name || undefined,
      targetFolder,
      noteFileNameFormat
    );
    await completeCapture(result);
    useHandwritingStore.setState({ statusMessage: `Saved ${result.note_path}.` });
    void refreshHandwritingJobs();
    await queueHandwritingOcr("auto");
  } catch (error) {
    useHandwritingStore.setState({ statusMessage: getErrorMessage(error) });
    throw error;
  } finally {
    useHandwritingStore.setState({ importBusy: false });
  }
}

const AUTO_QUEUE_INTERVAL_MS = 15_000;

/** Arm the auto-OCR loop. Ticks no-op while locked, profile-less, or unconfigured. */
export function initHandwriting() {
  const tick = () => {
    if (
      selectIsLocked(useSecurityStore.getState()) ||
      !selectActiveProfileId(useProfilesStore.getState())
    ) {
      return;
    }
    const config = getProviderConfig();
    if (!config.apiKey || !config.model) {
      return;
    }
    void queueHandwritingOcr("auto");
  };
  tick();
  window.setInterval(tick, AUTO_QUEUE_INTERVAL_MS);
  useProfilesStore.subscribe((state, previous) => {
    if (selectActiveProfileId(state) && !selectActiveProfileId(previous)) {
      tick();
    }
  });
}
