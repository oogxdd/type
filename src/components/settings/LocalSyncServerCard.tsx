import { useCallback, useEffect, useState } from "react";
import * as gitApi from "../../data/gitApi";
import type { LocalSyncServerStatus } from "../../types";
import { Button } from "../ui/button";

/**
 * Desktop-only "host" control: starts/stops a local `git daemon` so a phone on
 * the same Wi-Fi (or connected to the phone's hotspot) can sync over `git://`
 * with no external remote. Renders nothing on devices that cannot host (mobile).
 */
export function LocalSyncServerCard() {
  const [status, setStatus] = useState<LocalSyncServerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await gitApi.getLocalSyncServerStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [status?.running]);

  const copy = useCallback((value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(value);
    window.setTimeout(() => setCopied((current) => (current === value ? null : current)), 1500);
  }, []);

  // Hosting isn't possible on this device (e.g. iOS) — hide the card entirely.
  if (status && !status.supported) {
    return null;
  }

  const running = Boolean(status?.running);

  return (
    <section className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">Local network server</h3>
        <p className="text-xs text-muted-foreground">
          Host this computer's notes over your local network so your phone can sync without an
          internet remote — same Wi-Fi, or your phone's personal hotspot.
        </p>
      </div>

      {status && !status.git_available ? (
        <p className="text-xs text-destructive">
          Hosting needs the Git command-line tools. On macOS run <code>xcode-select --install</code>{" "}
          and try again.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
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
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {running ? (
        <div className="space-y-3">
          {status?.host ? null : (
            <p className="text-xs text-destructive">
              Couldn't auto-detect this computer's network address. Find it in System Settings →
              Network and use <code>git://&lt;your-ip&gt;/{status?.repo_path.split("/").pop()}</code>.
            </p>
          )}
          <UrlRow
            label="On your phone, paste this Remote URL"
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
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>On the phone: open Settings → Profile → Git.</li>
            <li>Paste the Remote URL above, set Branch to <code>main</code>, tap Apply Git settings.</li>
            <li>Tap <strong>Sync now</strong> in Settings → Sync.</li>
          </ol>
        </div>
      ) : null}
    </section>
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
