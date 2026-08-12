import { invokeLogged } from "@/shared/api/invoke";
import type {
  IrohDocsBootstrapResult,
  IrohDocsSyncResult,
  IrohDocsSyncStatus,
  SetIrohDocsSyncPeerArgs,
} from "@typenotes/shared/types";

export const bootstrapIrohDocsSync = (): Promise<IrohDocsBootstrapResult> =>
  invokeLogged<IrohDocsBootstrapResult>("bootstrap_iroh_docs_sync");

export const getIrohDocsSyncStatus = (): Promise<IrohDocsSyncStatus> =>
  invokeLogged<IrohDocsSyncStatus>("get_iroh_docs_sync_status");

export const syncIrohDocsNow = (): Promise<IrohDocsSyncResult> =>
  invokeLogged<IrohDocsSyncResult>("sync_iroh_docs_now");

export const setIrohDocsSyncPeer = (
  args: SetIrohDocsSyncPeerArgs
): Promise<IrohDocsSyncStatus> =>
  invokeLogged<IrohDocsSyncStatus>("set_iroh_docs_sync_peer", { args });
