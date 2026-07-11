import { useEffect, useMemo } from "react";
import { PenLine } from "lucide-react";
import {
  selectSyncSettings,
  useProfilesStore,
} from "@/features/profiles/state/profiles-store";
import { useHandwriting } from "@/features/handwriting/hooks/handwriting-context";
import {
  formatHandwritingStatus,
  formatRecordingStatusLabel,
  type NotePreview,
} from "@typenotes/shared/format";

type HandwritingNoteHeaderProps = {
  notePath: string | null;
  preview?: NotePreview;
};

export function HandwritingNoteHeader({
  notePath,
  preview,
}: HandwritingNoteHeaderProps) {
  const syncSettings = useProfilesStore(selectSyncSettings);
  const {
    handwritingJobs,
    handwritingQueue,
    handwritingError,
    handwritingQueueBusy,
    refreshHandwritingJobs,
    queueHandwritingOcr,
  } = useHandwriting();

  const handwritingItem = useMemo(
    () => handwritingJobs.find((item) => item.note_path === notePath),
    [handwritingJobs, notePath]
  );
  const isHandwriting = Boolean(notePath && (preview?.isHandwriting || handwritingItem));
  const effectiveStatus = handwritingItem
    ? formatHandwritingStatus(handwritingItem)
    : preview?.ocrStatus || "pending";
  const isProcessing = handwritingItem?.is_processing ?? effectiveStatus === "processing";
  const isQueued = handwritingItem?.is_queued ?? effectiveStatus === "queued";
  const queueIndex = notePath ? handwritingQueue?.pending.indexOf(notePath) ?? -1 : -1;
  const queuePosition = queueIndex >= 0 ? queueIndex + 1 : null;
  const queuePositionLabel = isProcessing ? "in progress" : isQueued ? queuePosition || "queued" : "-";
  const attachmentPath =
    handwritingItem?.attachment_path || preview?.handwritingAttachmentPath || null;

  const providerConfig =
    syncSettings.handwritingOcrProvider === "huggingface"
      ? {
          apiKey: syncSettings.huggingFaceApiKey.trim(),
          model: syncSettings.huggingFaceModel.trim(),
        }
      : {
          apiKey: syncSettings.openAiApiKey.trim(),
          model: syncSettings.openAiModel.trim(),
        };
  const hasProviderConfig =
    providerConfig.apiKey.length > 0 && providerConfig.model.length > 0;
  const showRunNow =
    Boolean(attachmentPath) && !isQueued && !isProcessing && effectiveStatus !== "completed";

  useEffect(() => {
    if (!isHandwriting) {
      return;
    }
    void refreshHandwritingJobs();
    const timer = window.setInterval(() => {
      void refreshHandwritingJobs();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [isHandwriting, refreshHandwritingJobs]);

  if (!isHandwriting || !notePath) {
    return null;
  }

  return (
    <div className="recording-note-header" role="status" aria-live="polite">
      <div className="recording-note-header-top">
        <span className="recording-note-chip">
          <PenLine size={13} />
          <span>Handwriting</span>
        </span>
      </div>

      <div className="recording-note-metrics">
        <div className="recording-note-metric">
          <span className="label">Status</span>
          <span className="value">{formatRecordingStatusLabel(effectiveStatus)}</span>
        </div>
        <div className="recording-note-metric">
          <span className="label">Queued</span>
          <span className="value">{isQueued || isProcessing ? "Yes" : "No"}</span>
        </div>
        <div className="recording-note-metric">
          <span className="label">Queue #</span>
          <span className="value">{queuePositionLabel}</span>
        </div>
      </div>

      <div className="recording-note-actions">
        {showRunNow ? (
          <button
            type="button"
            className="recording-note-btn"
            onClick={() => {
              void (async () => {
                await queueHandwritingOcr("manual");
                await refreshHandwritingJobs();
              })();
            }}
            disabled={handwritingQueueBusy}
          >
            {handwritingQueueBusy ? "Queueing..." : "Run OCR now"}
          </button>
        ) : null}
      </div>

      {!attachmentPath ? (
        <p className="recording-note-message">Attachment file is missing for this note.</p>
      ) : null}
      {!hasProviderConfig && showRunNow ? (
        <p className="recording-note-message">
          Configure OCR provider key and model in settings to run handwriting OCR.
        </p>
      ) : null}
      {handwritingError ? <p className="recording-note-message error">{handwritingError}</p> : null}
    </div>
  );
}
