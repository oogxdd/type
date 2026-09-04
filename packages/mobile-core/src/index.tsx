// Committed fallback package entry for clean clones, CI, and Expo Go.
//
// `uniffi-bindgen-react-native` overwrites this file on a Mac with the real
// TurboModule entry during native codegen. Until then, expose the in-memory
// RawCore implementation so TypeScript/Metro can resolve the package root and
// the app can boot in explicitly labelled demo mode.

import { createMockCore } from "./mock-core";

const demoCore = createMockCore({ seed: true });

export const __isDemoCore = true;

export const {
  initCore,
  getTree,
  readNote,
  createNote,
  writeNote,
  setNoteTimestamp,
  updateNoteMarkers,
  getNoteMeta,
  listNotePreviews,
  moveItems,
  deleteItems,
  renameItem,
  setOrder,
  getProfiles,
  createProfile,
  setActiveProfile,
  setProfileNotesRoot,
  updateProfile,
  deleteProfile,
  updateProfileSettings,
  updateAppConfig,
  createProfilesBackupZip,
  exportProfilesToDocuments,
  generateSshKey,
  getSshPublicKey,
  deleteSshKey,
  getGitStatus,
  getGitHistory,
  connectGitRepo,
  gitPull,
  gitCommit,
  gitPush,
  getGitSyncProgress,
  saveAudioRecording,
  queueRecordingTranscriptions,
  queueProviderTranscriptions,
  listRecordings,
  readRecordingAudio,
  saveHandwritingAttachment,
  getSecurityState,
  enableSecurity,
  lockSecurity,
  unlockSecurity,
  setSecurityPreferences,
} = demoCore;
