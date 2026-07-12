// Wires a RawCore implementation and initializes the Rust core.
//
// The package root is a committed in-memory fallback in clean clones and
// Expo Go. Native codegen overwrites that entry with the real TurboModule on
// a Mac. The fallback carries a marker so the UI can label demo mode; the
// generated module intentionally has no such marker.

import * as FileSystem from "expo-file-system/legacy";

import * as generated from "@typenotes/mobile-core";
import { initCore } from "@typenotes/mobile-core/core-api";
import {
  isRawCoreSet,
  setRawCore,
  type RawCore,
} from "@typenotes/mobile-core/raw-core";

/** expo-file-system returns file:// URIs; the Rust core wants plain paths. */
const uriToPath = (uri: string) => decodeURI(uri.replace(/^file:\/\//, ""));

export type BootResult = {
  demoMode: boolean;
};

export const bootCore = async (): Promise<BootResult> => {
  const coreModule = generated as RawCore & { __isDemoCore?: boolean };
  const demoMode = coreModule.__isDemoCore === true;
  if (!isRawCoreSet()) {
    setRawCore(coreModule);
  }

  // The app's Documents directory is user-visible in the Files app
  // (UIFileSharingEnabled + LSSupportsOpeningDocumentsInPlace), so working
  // folders created under it can be browsed and backed up by the user.
  const documents = FileSystem.documentDirectory
    ? uriToPath(FileSystem.documentDirectory)
    : "";
  await initCore(`${documents}typenotes`, documents);
  return { demoMode };
};
