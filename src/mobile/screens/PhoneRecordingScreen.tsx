import { MobileRecordingScreen } from "../components/MobileRecordingScreen";
import { useRecordings } from "../../contexts/RecordingsContext";
import { useSessions } from "../../contexts/SessionsContext";

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
  const { syncSettings } = useSessions();

  const isRecordingBusy = isRecordingFinalizing || transcriptionQueueBusy;

  return (
    <MobileRecordingScreen
      recordingSupported={recordingSupported}
      isRecording={isRecordingAudio}
      isBusy={isRecordingBusy}
      recordingError={recorderError}
      recordingStatus={recordingStatusMessage}
      recordingLiveStatus={recordingLiveStatus}
      hasAssemblyApiKey={syncSettings.assemblyAiApiKey.trim().length > 0}
      onStart={() => startRecording(folderPath)}
      onStop={stopRecording}
      onQueue={() => void queueRecordingTranscriptions("manual")}
      autoStart={autoStart}
    />
  );
}
