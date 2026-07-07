// Wires a RawCore implementation and initializes the Rust core.
//
// On a real device build, generate the native module first (see
// packages/mobile-core/README.md), then wire it by replacing the mock below:
//
//   import * as generated from "@typenotes/mobile-core/generated";
//   setRawCore(generated);
//
// The import must stay commented out until codegen has run — Metro resolves
// imports statically and would fail the bundle otherwise. Without the native
// module the app boots against the in-memory mock ("demo mode"): fully
// interactive, nothing persisted, banner shown in the UI.

import * as FileSystem from "expo-file-system/legacy";

import * as generated from "@typenotes/mobile-core";
import { initCore } from "@typenotes/mobile-core/core-api";
import { isRawCoreSet, setRawCore } from "@typenotes/mobile-core/raw-core";

/** expo-file-system returns file:// URIs; the Rust core wants plain paths. */
const uriToPath = (uri: string) => decodeURI(uri.replace(/^file:\/\//, ""));

export type BootResult = {
  demoMode: boolean;
};

export const bootCore = async (): Promise<BootResult> => {
  let demoMode = false;
  if (!isRawCoreSet()) {
    setRawCore(generated);
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
