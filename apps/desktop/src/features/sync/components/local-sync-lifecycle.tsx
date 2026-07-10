import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import * as gitApi from "@/features/sync/api/git-api";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { getErrorMessage } from "@typenotes/shared/errors";
import type { PendingLocalSyncRequest } from "@typenotes/shared/types";

export function LocalSyncLifecycle() {
  const { appConfig, activeProfileNotesRoot } = useProfiles();
  const askBeforeSync = Boolean(appConfig?.local_sync_ask_before_sync);
  const autoListenerRunning = useRef(false);
  const autoListenerDesired = useRef(false);
  const [request, setRequest] = useState<PendingLocalSyncRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<PendingLocalSyncRequest>("local-sync-requested", (event) => {
      setError(null);
      setRequest(event.payload);
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  // Starting again is idempotent for one profile; the core restarts the
  // listener if the active notes root changed.
  useEffect(() => {
    autoListenerDesired.current = askBeforeSync;
    if (!askBeforeSync || !activeProfileNotesRoot) {
      if (autoListenerRunning.current) {
        autoListenerRunning.current = false;
        void gitApi.stopLocalSyncServer().catch(() => {});
      }
      return;
    }
    void gitApi
      .startLocalSyncRequestListener()
      .then(() => {
        if (!autoListenerDesired.current) {
          void gitApi.stopLocalSyncServer().catch(() => {});
          return;
        }
        autoListenerRunning.current = true;
      })
      .catch((cause) => setError(getErrorMessage(cause)));
  }, [
    activeProfileNotesRoot,
    appConfig?.local_sync_idle_timeout_minutes,
    askBeforeSync,
  ]);

  useEffect(
    () => () => {
      autoListenerDesired.current = false;
      if (autoListenerRunning.current) {
        autoListenerRunning.current = false;
        void gitApi.stopLocalSyncServer().catch(() => {});
      }
    },
    []
  );

  const decide = useCallback(async (approved: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (approved) {
        await gitApi.approveLocalSyncRequest();
      } else {
        await gitApi.declineLocalSyncRequest();
      }
      setRequest(null);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open && request && !busy) {
          void decide(false);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Allow sync from {request?.device_name ?? "phone"}?</DialogTitle>
          <DialogDescription>
            This opens local Git sync for {appConfig?.local_sync_idle_timeout_minutes ?? 10}
            minutes. The timer restarts after each completed transfer.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => void decide(false)} disabled={busy}>
            Decline
          </Button>
          <Button onClick={() => void decide(true)} disabled={busy}>
            {busy ? "Opening..." : "Accept sync"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
