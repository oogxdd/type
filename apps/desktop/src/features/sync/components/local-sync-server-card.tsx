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

export function LocalSyncServerCard() {
  const [status, setStatus] = useState<LocalSyncServerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await gitApi.getLocalSyncServerStatus());
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleServer = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = status?.running
        ? await gitApi.stopLocalSyncServer()
        : await gitApi.startLocalSyncServer();
      setStatus(next);
    } catch (err) {
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

  const running = Boolean(status?.running);

  const deepLink = useMemo(() => {
    if (!status?.git_url) {
      return null;
    }
    return buildSyncDeepLink({
      remote: status.git_url,
      branch: status.branch ?? undefined,
      name: status.host ? `Computer (${status.host})` : undefined,
    });
  }, [status?.git_url, status?.branch, status?.host]);

  return (
    <SettingsCard
      title="Local network server"
      description="Host this computer's notes over your local network so your phone can sync without an internet remote — same Wi-Fi, or your phone's personal hotspot."
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
          {running ? "Running — keep this app open while syncing." : "Stopped"}
        </span>
      </SettingsActionRow>

      {error ? <SettingsErrorText>{error}</SettingsErrorText> : null}

      {running ? (
        <div className="space-y-4">
          {status?.host ? null : (
            <SettingsErrorText>
              Couldn't auto-detect this computer's network address. Find it in System Settings →
              Network and use <code>git://&lt;your-ip&gt;/{status?.repo_path.split("/").pop()}</code>.
            </SettingsErrorText>
          )}

          {deepLink ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-border/50 bg-background/60 p-4">
              <div className="rounded-md bg-white p-3">
                <QRCodeSVG value={deepLink} size={168} marginSize={0} />
              </div>
              <p className="text-center text-xs text-muted-foreground">
                <strong className="text-foreground">Point your phone's Camera at this</strong> to
                open the app and sync — nothing to type.
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <SettingsHelpText>Or set it up by hand:</SettingsHelpText>
            <UrlRow
              label="Remote URL"
              value={status?.git_url ?? ""}
              copied={copied}
              onCopy={copy}
            />
            {status?.ssh_url ? (
              <UrlRow
                label="Or, with macOS Remote Login enabled (more secure)"
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
