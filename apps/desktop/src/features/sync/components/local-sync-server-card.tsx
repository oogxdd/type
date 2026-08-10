import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import * as gitApi from "@/features/sync/api/git-api";
import { buildSyncDeepLink } from "@typenotes/shared/sync-link";
import type { LocalSyncServerStatus } from "@typenotes/shared/types";
import { Button } from "@/shared/ui/button";
import { getErrorMessage } from "@typenotes/shared/errors";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsErrorText,
  SettingsHelpText,
} from "@/features/settings/components/settings-ui";

const redactRemoteForLog = (remote: string | null | undefined): string => {
  if (!remote) return "<none>";
  const match = remote.match(/^([a-z][a-z0-9+.-]*:\/\/)([^@/?#]+)@(.+)$/i);
  if (!match) return remote;
  const [, scheme, userinfo, rest] = match;
  if (scheme.toLowerCase() === "ssh://" && userinfo.toLowerCase().startsWith("pair-")) {
    const token = userinfo.slice("pair-".length);
    return `${scheme}pair-<token:${token.slice(-6)}>@${rest}`;
  }
  return `${scheme}${userinfo.includes(":") ? "<credentials>" : userinfo}@${rest}`;
};

const statusForLog = (status: LocalSyncServerStatus): string =>
  `running=${status.running} supported=${status.supported} git=${status.git_available} host=${
    status.host ?? "<none>"
  } branch=${status.branch ?? "<none>"} ssh=${redactRemoteForLog(status.ssh_url)} paired=${
    status.paired_devices.length
  } iroh=${status.iroh_endpoint_id ?? "<none>"} error=${status.error ?? "<none>"}`;

export function LocalSyncServerCard() {
  const [status, setStatus] = useState<LocalSyncServerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Opening the settings page only reads status. The first start remains an
  // explicit user action; after that, app startup restores the server until
  // the user explicitly stops it.
  const refresh = useCallback(async () => {
    try {
      const current = await gitApi.getLocalSyncServerStatus();
      console.log(`[local-sync:ui] status: ${statusForLog(current)}`);
      setStatus(current);
    } catch (err) {
      console.log(`[local-sync:ui] status failed: ${getErrorMessage(err)}`);
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While the server runs, poll the status: pairing rotates the token (the QR
  // must re-render with the live one) and newly paired devices should show up
  // without a manual refresh.
  const running = Boolean(status?.running);
  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = window.setInterval(() => {
      void gitApi
        .getLocalSyncServerStatus()
        .then(setStatus)
        .catch(() => {});
    }, 4000);
    return () => window.clearInterval(timer);
  }, [running]);

  const toggleServer = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = status?.running
        ? await gitApi.stopLocalSyncServer()
        : await gitApi.startLocalSyncServer();
      console.log(`[local-sync:ui] toggled server: ${statusForLog(next)}`);
      setStatus(next);
    } catch (err) {
      console.log(`[local-sync:ui] toggle failed: ${getErrorMessage(err)}`);
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [status?.running]);

  const copy = useCallback((value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(value);
    window.setTimeout(() => setCopied((current) => (current === value ? null : current)), 1500);
  }, []);

  if (status && !status.supported) {
    return null;
  }

  const deepLink = useMemo(() => {
    if (!status?.ssh_url) {
      return null;
    }
    return buildSyncDeepLink({
      remote: status.ssh_url,
      branch: status.branch ?? undefined,
      name: status.host ? `Computer (${status.host})` : undefined,
      hostKeySha256: status.host_key_sha256 ?? undefined,
      irohTicket: status.iroh_ticket ?? undefined,
    });
  }, [
    status?.ssh_url,
    status?.branch,
    status?.host,
    status?.host_key_sha256,
    status?.iroh_ticket,
  ]);

  return (
    <SettingsCard
      title="Direct sync server"
      description="Host this computer's notes over SSH through Iroh. Devices connect directly when possible and use an encrypted relay when necessary; the relay does not store your notes."
    >
      {status && !status.git_available ? (
        <SettingsErrorText>
          Hosting needs the Git command-line tools. On macOS run <code>xcode-select --install</code>{" "}
          and try again.
        </SettingsErrorText>
      ) : null}

      <SettingsActionRow>
        <Button
          size="sm"
          type="button"
          variant={running ? "destructive" : "default"}
          onClick={() => void toggleServer()}
          disabled={busy || (status ? !status.git_available : true)}
        >
          {busy
            ? running
              ? "Stopping..."
              : "Starting..."
            : running
              ? "Stop server"
              : "Start server"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {busy
            ? running
              ? "Stopping local SSH..."
              : "Starting local SSH..."
            : running
              ? "Running — it will start automatically next time you open the app."
              : "Stopped"}
        </span>
      </SettingsActionRow>

      {error ? <SettingsErrorText>{error}</SettingsErrorText> : null}

      {running ? (
        <div className="space-y-4">
          {status?.host || status?.iroh_ticket ? null : (
            <SettingsErrorText>
              Couldn't auto-detect this computer's network address. Find it in System Settings →
              Network and use the SSH URL below with your computer's IP address.
            </SettingsErrorText>
          )}

          {deepLink ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-border/50 bg-background/60 p-4">
              <div className="rounded-md bg-white p-3">
                <QRCodeSVG value={deepLink} size={224} marginSize={0} />
              </div>
              <p className="text-center text-xs text-muted-foreground">
                <strong className="text-foreground">Point your phone's Camera at this</strong> to
                pair once. The phone can sync without staying on the same Wi-Fi.
              </p>
            </div>
          ) : null}

          <div className="space-y-1">
            <SettingsHelpText>
              {status?.paired_devices.length
                ? "Paired devices:"
                : "No phone paired yet — scan the QR code from the phone's Sync screen."}
            </SettingsHelpText>
            {status?.paired_devices.map((device) => (
              <p key={`${device.name}-${device.added_ms}`} className="text-xs text-foreground">
                ✓ {device.name} · paired {new Date(device.added_ms).toLocaleString()}
              </p>
            ))}
          </div>

          <div className="space-y-2">
            <SettingsHelpText>Or set it up by hand:</SettingsHelpText>
            {status?.iroh_endpoint_id ? (
              <SettingsHelpText>
                Iroh endpoint: <code>{status.iroh_endpoint_id}</code>
              </SettingsHelpText>
            ) : null}
            {status?.ssh_url ? (
              <UrlRow
                label="Pairing SSH URL"
                value={status.ssh_url}
                copied={copied}
                onCopy={copy}
              />
            ) : null}
            <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
              <li>
                On the phone: menu → <strong>Sync</strong> → <strong>Scan QR code</strong>, point at
                the code above, then tap <strong>Sync now</strong>.
              </li>
              <li>
                No camera? Sync → Advanced: paste the Remote URL, set Branch to{" "}
                <code>{status?.branch ?? "main"}</code>, <strong>Save &amp; connect</strong>, then{" "}
                <strong>Sync now</strong>.
              </li>
              <li>
                This URL is served by Type itself over SSH. macOS Remote Login and{" "}
                <code>authorized_keys</code> are not required.
              </li>
            </ol>
          </div>
        </div>
      ) : null}
    </SettingsCard>
  );
}

function UrlRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: string | null;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code className="block flex-1 break-all rounded bg-muted/50 p-2 text-xs text-foreground select-all">
          {value}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={() => onCopy(value)}>
          {copied === value ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
