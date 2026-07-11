import type {
  AppConfig,
  ProfileSettings,
  ProfileSyncSettings,
} from "@typenotes/shared/types";
import { DEFAULT_PROFILE_SYNC_SETTINGS } from "@/shared/lib/storage";

export const LEGACY_PROFILE_SYNC_STORAGE_KEYS = [
  "notes-viewer-git-remote",
  "notes-viewer-git-branch",
  "notes-viewer-git-username",
  "notes-viewer-git-password",
  "notes-viewer-git-commit-message",
  "notes-viewer-git-last-sync-at",
  "notes-viewer-note-file-name-format",
  "notes-viewer-assemblyai-api-key",
  "notes-viewer-mobile-auto-transcription-enabled",
  "notes-viewer-handwriting-ocr-provider",
  "notes-viewer-openai-api-key",
  "notes-viewer-openai-model",
  "notes-viewer-huggingface-api-key",
  "notes-viewer-huggingface-model",
  "notes-viewer-mobile-auto-handwriting-ocr-enabled",
];

const normalizeNoteFileNameFormat = (
  value: string
): ProfileSyncSettings["noteFileNameFormat"] => {
  if (value === "uuid_v7" || value === "uuid_v7_prefix_slug") {
    return value;
  }
  return "utc_timestamp_slug";
};

const normalizeHandwritingProvider = (
  value: string
): ProfileSyncSettings["handwritingOcrProvider"] =>
  value === "openai" || value === "huggingface" ? value : "local";

export const profileSyncSettingsFromState = (
  appConfig: AppConfig | null,
  profileSettings: ProfileSettings | null
): ProfileSyncSettings => {
  if (!appConfig || !profileSettings) {
    return { ...DEFAULT_PROFILE_SYNC_SETTINGS };
  }

  // Backend state is split intentionally: app-wide provider/model defaults live
  // in app_config, while Git remotes and mobile auto-queue preferences belong
  // to the active workspace/profile.
  return {
    gitRemoteUrl: profileSettings.git_remote_url,
    gitBranch: profileSettings.git_branch,
    gitUsername: profileSettings.git_username,
    gitPassword: profileSettings.git_password,
    gitCommitMessage: profileSettings.git_commit_message,
    lastSuccessfulSyncAt: DEFAULT_PROFILE_SYNC_SETTINGS.lastSuccessfulSyncAt,
    noteFileNameFormat: normalizeNoteFileNameFormat(appConfig.note_file_name_format),
    assemblyAiApiKey: appConfig.assemblyai_api_key,
    mobileAutoTranscriptionEnabled:
      profileSettings.mobile_auto_transcription_enabled,
    whisperModel: appConfig.whisper_model,
    handwritingOcrProvider: normalizeHandwritingProvider(
      appConfig.handwriting_ocr_provider
    ),
    localOcrModelPath: appConfig.local_ocr_model_path,
    openAiApiKey: appConfig.openai_api_key,
    openAiModel: appConfig.openai_model,
    huggingFaceApiKey: appConfig.huggingface_api_key,
    huggingFaceModel: appConfig.huggingface_model,
    mobileAutoHandwritingOcrEnabled:
      profileSettings.mobile_auto_handwriting_ocr_enabled,
  };
};

export const splitProfileSyncSettingsPatch = (
  patch: Partial<ProfileSyncSettings>
) => {
  const appConfigPatch: Partial<AppConfig> = {};
  const profileSettingsPatch: Partial<ProfileSettings> = {};

  if ("noteFileNameFormat" in patch) {
    appConfigPatch.note_file_name_format = patch.noteFileNameFormat;
  }
  if ("assemblyAiApiKey" in patch) {
    appConfigPatch.assemblyai_api_key = patch.assemblyAiApiKey;
  }
  if ("whisperModel" in patch) {
    appConfigPatch.whisper_model = patch.whisperModel;
  }
  if ("handwritingOcrProvider" in patch) {
    appConfigPatch.handwriting_ocr_provider = patch.handwritingOcrProvider;
  }
  if ("localOcrModelPath" in patch) {
    appConfigPatch.local_ocr_model_path = patch.localOcrModelPath;
  }
  if ("openAiApiKey" in patch) {
    appConfigPatch.openai_api_key = patch.openAiApiKey;
  }
  if ("openAiModel" in patch) {
    appConfigPatch.openai_model = patch.openAiModel;
  }
  if ("huggingFaceApiKey" in patch) {
    appConfigPatch.huggingface_api_key = patch.huggingFaceApiKey;
  }
  if ("huggingFaceModel" in patch) {
    appConfigPatch.huggingface_model = patch.huggingFaceModel;
  }

  if ("gitRemoteUrl" in patch) {
    profileSettingsPatch.git_remote_url = patch.gitRemoteUrl;
  }
  if ("gitBranch" in patch) {
    profileSettingsPatch.git_branch = patch.gitBranch;
  }
  if ("gitUsername" in patch) {
    profileSettingsPatch.git_username = patch.gitUsername;
  }
  if ("gitPassword" in patch) {
    profileSettingsPatch.git_password = patch.gitPassword;
  }
  if ("gitCommitMessage" in patch) {
    profileSettingsPatch.git_commit_message = patch.gitCommitMessage;
  }
  if ("mobileAutoTranscriptionEnabled" in patch) {
    profileSettingsPatch.mobile_auto_transcription_enabled =
      patch.mobileAutoTranscriptionEnabled;
  }
  if ("mobileAutoHandwritingOcrEnabled" in patch) {
    profileSettingsPatch.mobile_auto_handwriting_ocr_enabled =
      patch.mobileAutoHandwritingOcrEnabled;
  }

  return {
    appConfigPatch,
    profileSettingsPatch,
  };
};
