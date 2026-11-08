import { requireOptionalNativeModule } from "expo-modules-core";

type BackupExportResult = {
  cancelled: boolean;
  destination_uri?: string;
  file_count?: number;
  total_bytes?: number;
};

type BackupExportNativeModule = {
  exportArchive(
    archivePath: string,
    suggestedName: string
  ): Promise<BackupExportResult>;
  copyFolder(
    sourcePath: string,
    destinationName: string
  ): Promise<BackupExportResult>;
};

const nativeModule =
  requireOptionalNativeModule<BackupExportNativeModule>("BackupExport");

const requiredModule = (): BackupExportNativeModule => {
  if (!nativeModule) {
    throw new Error(
      "Backups need the native mobile build; they are unavailable in Expo Go or demo mode."
    );
  }
  return nativeModule;
};

export const exportArchiveToFiles = (
  archivePath: string,
  suggestedName: string
): Promise<BackupExportResult> =>
  requiredModule().exportArchive(archivePath, suggestedName);

export const copyWorkingFolderToFiles = (
  sourcePath: string,
  destinationName: string
): Promise<BackupExportResult> =>
  requiredModule().copyFolder(sourcePath, destinationName);
