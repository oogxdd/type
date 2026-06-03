import { MobileRecordingScreen } from "@/mobile/views/recording-view";
import { useRecordings } from "@/features/recording/hooks/recordings-context";
import { useProfiles } from "@/contexts/profiles-context";
import { useHandwriting } from "@/contexts/handwriting-context";
import { useRef, type ChangeEvent } from "react";

type PhoneRecordingScreenProps = {
  folderPath: string;
  autoStart?: boolean;
};

export function PhoneRecordingScreen({
  folderPath,
  autoStart,
}: PhoneRecordingScreenProps) {
  const {
    recordingSupported,
    isRecordingAudio,
    isRecordingFinalizing,
    recorderError,
    recordingStatusMessage,
    recordingLiveStatus,
    transcriptionQueueBusy,
    startRecording,
    stopRecording,
    queueRecordingTranscriptions,
  } = useRecordings();
  const {
    handwritingImportBusy,
    handwritingQueueBusy,
    handwritingStatusMessage,
    handwritingError,
    importHandwritingFile,
    queueHandwritingOcr,
  } = useHandwriting();
  const { syncSettings } = useProfiles();
  const handwritingInputRef = useRef<HTMLInputElement | null>(null);

  const isRecordingBusy = isRecordingFinalizing || transcriptionQueueBusy;
  const handwritingConfig =
    syncSettings.handwritingOcrProvider === "huggingface"
      ? {
          apiKey: syncSettings.huggingFaceApiKey.trim(),
          model: syncSettings.huggingFaceModel.trim(),
        }
      : {
          apiKey: syncSettings.openAiApiKey.trim(),
          model: syncSettings.openAiModel.trim(),
        };
  const hasHandwritingProviderConfig =
    handwritingConfig.apiKey.length > 0 && handwritingConfig.model.length > 0;

  const onHandwritingInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }
    void importHandwritingFile(file, folderPath).catch((error) => {
      console.error("[handwriting] mobile import failed", error);
    });
  };

  return (
    <>
      <input
        ref={handwritingInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={onHandwritingInputChange}
      />
      <MobileRecordingScreen
        recordingSupported={recordingSupported}
        isRecording={isRecordingAudio}
        isBusy={isRecordingBusy}
        recordingError={recorderError}
        recordingStatus={recordingStatusMessage}
        recordingLiveStatus={recordingLiveStatus}
        hasAssemblyApiKey={syncSettings.assemblyAiApiKey.trim().length > 0}
        handwritingImportBusy={handwritingImportBusy}
        handwritingQueueBusy={handwritingQueueBusy}
        handwritingStatus={handwritingStatusMessage}
        handwritingError={handwritingError}
        hasHandwritingProviderConfig={hasHandwritingProviderConfig}
        onStart={() => startRecording(folderPath)}
        onStop={stopRecording}
        onQueue={() => void queueRecordingTranscriptions("manual")}
        onPickHandwriting={() => handwritingInputRef.current?.click()}
        onQueueHandwriting={() => void queueHandwritingOcr("manual")}
        autoStart={autoStart}
      />
    </>
  );
}
