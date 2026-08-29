export type CloudSyncProvider = {
  id: string;
  label: string;
  defaultPath: (home: string) => string;
};

// Each of these syncs a local folder in the background on its own — pointing
// notes_root inside one is enough, no provider-specific code is needed here.
// Add new providers (Google Drive, Dropbox, ...) as additional entries.
export const CLOUD_SYNC_PROVIDERS: CloudSyncProvider[] = [
  {
    id: "icloud",
    label: "iCloud Drive",
    defaultPath: (home) => `${home}/Library/Mobile Documents/com~apple~CloudDocs`,
  },
];
