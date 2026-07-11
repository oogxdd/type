import { useCallback, useEffect, useState } from "react";

import * as gitApi from "@/api/git-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import { confirmAction } from "@/lib/dom";

const DELETE_CONFIRM_MESSAGE =
  "Delete the SSH keypair? You will need to re-add the public key to your server.";

export type SshKeyState = {
  /** The app-managed public key, or null when no keypair exists yet. */
  sshPublicKey: string | null;
  /** True while a generate/delete request is in flight. */
  sshBusy: boolean;
  /** Last generate/delete error message, or null. */
  sshError: string | null;
  /** Generate a fresh Ed25519 keypair and load its public key. */
  generateSshKey: () => Promise<void>;
  /** Delete the keypair (after a confirm prompt). */
  deleteSshKey: () => Promise<void>;
};

/**
 * Owns the app-managed SSH keypair lifecycle — load on mount, generate, delete —
 * shared by the desktop and mobile profile/sync settings sections. This was
 * previously copy-pasted verbatim into both `profile-section` components; the
 * behavior here is identical.
 */
export const useSshKey = (): SshKeyState => {
  const [sshPublicKey, setSshPublicKey] = useState<string | null>(null);
  const [sshBusy, setSshBusy] = useState(false);
  const [sshError, setSshError] = useState<string | null>(null);

  const refreshSshKey = useCallback(async () => {
    try {
      const key = await gitApi.getSshPublicKey();
      setSshPublicKey(key);
    } catch {
      setSshPublicKey(null);
    }
  }, []);

  useEffect(() => {
    void refreshSshKey();
  }, [refreshSshKey]);

  const generateSshKey = useCallback(async () => {
    setSshBusy(true);
    setSshError(null);
    try {
      const pubKey = await gitApi.generateSshKey();
      setSshPublicKey(pubKey);
    } catch (error) {
      setSshError(getErrorMessage(error));
    } finally {
      setSshBusy(false);
    }
  }, []);

  const deleteSshKey = useCallback(async () => {
    if (!(await confirmAction(DELETE_CONFIRM_MESSAGE))) {
      return;
    }
    setSshBusy(true);
    setSshError(null);
    try {
      await gitApi.deleteSshKey();
      setSshPublicKey(null);
    } catch (error) {
      setSshError(getErrorMessage(error));
    } finally {
      setSshBusy(false);
    }
  }, []);

  return { sshPublicKey, sshBusy, sshError, generateSshKey, deleteSshKey };
};
