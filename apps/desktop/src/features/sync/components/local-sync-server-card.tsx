import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import * as gitApi from "@/features/sync/api/git-api";
import { buildSyncDeepLink } from "@typenotes/shared/sync-link";
import type { LocalSyncServerStatus } from "@typenotes/shared/types";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { getErrorMessage } from "@typenotes/shared/errors";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsErrorText,
  SettingsField,
  SettingsHelpText,
  SettingsSelect,
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
  `running=${status.running} window=${status.sync_window_open} remaining=${status.sync_window_seconds_remaining}s supported=${status.supported} git=${status.git_available} host=${
    status.host ?? "<none>"
  } branch=${status.branch ?? "<none>"} ssh=${redactRemoteForLog(status.ssh_url)} paired=${
    status.paired_devices.length
  } error=${status.error ?? "<none>"}`;

export function LocalSyncServerCard() {
  const { appConfig, updateAppConfig } = useProfiles();
  const [status, setStatus] = useState<LocalSyncServerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Opening the settings page only *reads* the server status. Starting is an
  // explicit user action — auto-starting opened a network port (and mDNS
  // broadcast) as a side effect of merely looking at the settings.
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

  const toggleWindow = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = status?.sync_window_open
        ? await gitApi.closeLocalSyncWindow()
        : await gitApi.openLocalSyncWindow();
      setStatus(next);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [status?.sync_window_open]);

  const decideRequest = useCallback(async (approved: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const next = approved
        ? await gitApi.approveLocalSyncRequest()
        : await gitApi.declineLocalSyncRequest();
      setStatus(next);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, []);

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
    });
  }, [status?.ssh_url, status?.branch, status?.host, status?.host_key_sha256]);

  return (
    <SettingsCard
      title="Local network server"
      description="Host this computer's notes over encrypted local SSH so your phone can sync without an internet remote — same Wi-Fi, or your phone's personal hotspot."
    >
      {status && !status.git_available ? (
        <SettingsErrorText>
          Hosting needs the Git command-line tools. On macOS run <code>xcode-select --install</code>{" "}
          and try again.
        </SettingsErrorText>
      ) : null}

      <label className="flex items-start gap-3 rounded-md border border-border/50 bg-background/40 p-3 text-sm">
        <Checkbox
          checked={Boolean(appConfig?.local_sync_ask_before_sync)}
          disabled={!appConfig || busy}
          onCheckedChange={(checked) =>
            void updateAppConfig({ local_sync_ask_before_sync: Boolean(checked) })
          }
          className="mt-0.5"
        />
        <span className="grid gap-1">
          <span className="font-medium text-foreground">Ask before syncing</span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            Paired phones can find this computer and request access. Notes stay unavailable until
            you accept.
          </span>
        </span>
      </label>

      <SettingsField label="Close sync window after">
        <SettingsSelect
          value={String(appConfig?.local_sync_idle_timeout_minutes ?? 10)}
          disabled={!appConfig || busy}
          onChange={(event) =>
            void updateAppConfig({
              local_sync_idle_timeout_minutes: Number(event.target.value),
            })
          }
        >
          <option value="5">5 minutes idle</option>
          <option value="10">10 minutes idle</option>
          <option value="15">15 minutes idle</option>
        </SettingsSelect>
      </SettingsField>

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
              ? status?.sync_window_open
                ? `Sync open · closes in about ${Math.max(
                    1,
                    Math.ceil((status.sync_window_seconds_remaining ?? 0) / 60)
                  )} min idle`
                : "Listening for paired-device requests"
              : "Stopped"}
        </span>
      </SettingsActionRow>

      {running ? (
        <SettingsActionRow>
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => void toggleWindow()}
            disabled={busy}
          >
            {status?.sync_window_open ? "Close sync now" : "Open sync window"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {status?.sync_window_open
              ? "Fetch and push are allowed from paired phones."
              : `Opens for ${status?.idle_timeout_minutes ?? 10} minutes.`}
          </span>
        </SettingsActionRow>
      ) : null}

      {status?.pending_request ? (
        <div className="space-y-2 rounded-md border border-border/60 bg-background/50 p-3">
          <p className="text-sm font-medium text-foreground">
            {status.pending_request.device_name} wants to sync
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void decideRequest(true)} disabled={busy}>
              Accept sync
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void decideRequest(false)}
              disabled={busy}
            >
              Decline
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <SettingsErrorText>{error}</SettingsErrorText> : null}

      {running ? (
        <div className="space-y-4">
          {status?.host ? null : (
            <SettingsErrorText>
              Couldn't auto-detect this computer's network address. Find it in System Settings →
              Network and use the SSH URL below with your computer's IP address.
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
