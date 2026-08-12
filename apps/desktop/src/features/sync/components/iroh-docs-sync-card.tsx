import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import * as syncApi from "@/features/sync/api/iroh-docs-sync-api";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { Button } from "@/shared/ui/button";
import { getErrorMessage } from "@typenotes/shared/errors";
import { buildSyncDeepLink } from "@typenotes/shared/sync-link";
import type {
  IrohDocsBootstrapResult,
  IrohDocsSyncResult,
  IrohDocsSyncStatus,
} from "@typenotes/shared/types";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsErrorText,
  SettingsHelpText,
  SettingsInfoGrid,
  SettingsInfoRow,
} from "@/features/settings/components/settings-ui";

const phaseLabel = (status: IrohDocsSyncStatus | null) => {
  switch (status?.phase) {
    case "saved_locally":
      return "Saved locally";
    case "syncing":
      return "Syncing…";
    case "synced":
      return "Synced";
    case "waiting_for_peer":
      return "Waiting for phone";
    case "error":
      return "Error";
    case "running":
      return "Ready";
    default:
      return status?.configured ? "Stopped" : "Not enabled";
  }
};

const resultLabel = (result: IrohDocsSyncResult | null) =>
  result
    ? `${result.published} published · ${result.applied} applied · ${result.conflicts} conflicts`
    : null;

export function IrohDocsSyncCard() {
  const { refreshTree } = useNotesTree();
  const [status, setStatus] = useState<IrohDocsSyncStatus | null>(null);
  const [bundle, setBundle] = useState<IrohDocsBootstrapResult | null>(null);
  const [peerTicket, setPeerTicket] = useState("");
  const [result, setResult] = useState<IrohDocsSyncResult | null>(null);
  const [busy, setBusy] = useState<"enable" | "sync" | "peer" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await syncApi.getIrohDocsSyncStatus());
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const pairingLink = useMemo(() => {
    if (!bundle) return null;
    return buildSyncDeepLink({
      name: "Computer",
      irohDocTicket: bundle.pairing.write_doc_ticket,
      irohVaultKey: bundle.pairing.vault_key,
      irohPeerTicket: bundle.pairing.peer_endpoint_ticket ?? undefined,
    });
  }, [bundle]);

  const enableOrPair = async () => {
    setBusy("enable");
    setError(null);
    try {
      const next = await syncApi.bootstrapIrohDocsSync();
      setBundle(next);
      setStatus(next.status);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const syncNow = async () => {
    setBusy("sync");
    setError(null);
    try {
      const next = await syncApi.syncIrohDocsNow();
      setResult(next);
      await refreshTree();
      await refresh();
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const savePeer = async () => {
    setBusy("peer");
    setError(null);
    try {
      setStatus(
        await syncApi.setIrohDocsSyncPeer({
          peer_endpoint_ticket: peerTicket.trim() || null,
        })
      );
      setBundle(null);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsCard
      title="Automatic encrypted sync"
      description="Markdown stays in your folders. Iroh reconciles encrypted current state directly, so autosaves do not create Git commits."
    >
      <SettingsInfoGrid>
        <SettingsInfoRow label="Status">
          <code className="text-xs">{phaseLabel(status)}</code>
        </SettingsInfoRow>
        <SettingsInfoRow label="Connected devices">
          <code className="text-xs">{status?.neighbors ?? 0}</code>
        </SettingsInfoRow>
        {status?.last_sync_ms ? (
          <SettingsInfoRow label="Last sync">
            <code className="text-xs">{new Date(status.last_sync_ms).toLocaleString()}</code>
          </SettingsInfoRow>
        ) : null}
      </SettingsInfoGrid>

      <SettingsActionRow>
        <Button size="sm" type="button" onClick={() => void enableOrPair()} disabled={busy !== null}>
          {busy === "enable"
            ? "Preparing…"
            : status?.configured
              ? "Pair another device"
              : "Enable sync"}
        </Button>
        {status?.configured ? (
          <Button size="sm" variant="secondary" type="button" onClick={() => void syncNow()} disabled={busy !== null}>
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </Button>
        ) : null}
      </SettingsActionRow>

      {resultLabel(result) ? <SettingsHelpText>{resultLabel(result)}</SettingsHelpText> : null}
      {status?.last_error ? <SettingsErrorText>{status.last_error}</SettingsErrorText> : null}
      {error ? <SettingsErrorText>{error}</SettingsErrorText> : null}

      {pairingLink ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border/50 bg-background/60 p-4">
          <div className="rounded-md bg-white p-3">
            <QRCodeSVG value={pairingLink} size={224} marginSize={0} />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Scan once from Type on your phone. This QR contains the vault key, so treat it like a password.
          </p>
        </div>
      ) : null}

      {bundle ? (
        <div className="space-y-2">
          <SettingsHelpText>
            Optional zero-knowledge sync peer: give it only this read-only document ticket. It never receives the vault key.
          </SettingsHelpText>
          <div className="flex items-center gap-2">
            <code className="block max-h-20 flex-1 overflow-auto break-all rounded bg-muted/50 p-2 text-xs">
              {bundle.peer_read_doc_ticket}
            </code>
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(bundle.peer_read_doc_ticket);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}

      {status?.configured ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Optional persistent sync peer</summary>
          <div className="mt-2 flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-foreground"
              value={peerTicket}
              onChange={(event) => setPeerTicket(event.target.value)}
              placeholder="iroh endpoint ticket"
            />
            <Button size="sm" variant="outline" type="button" onClick={() => void savePeer()} disabled={busy !== null}>
              {busy === "peer" ? "Saving…" : "Save"}
            </Button>
          </div>
        </details>
      ) : null}
    </SettingsCard>
  );
}
