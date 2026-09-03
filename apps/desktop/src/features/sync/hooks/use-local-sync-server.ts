import { useCallback, useEffect, useState } from "react";

import * as gitApi from "@/features/sync/api/git-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import type { LocalSyncServerStatus } from "@typenotes/shared/types";

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
  } iroh=${status.iroh_endpoint_id ?? "<none>"} relay=${
    status.iroh_relay ?? "<pending>"
  } error=${status.error ?? "<none>"}`;

export function useLocalSyncServer() {
  const [status, setStatus] = useState<LocalSyncServerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const current = await gitApi.getLocalSyncServerStatus();
      console.log(`[local-sync:ui] status: ${statusForLog(current)}`);
      setStatus(current);
      setError(null);
    } catch (cause) {
      const message = getErrorMessage(cause);
      console.log(`[local-sync:ui] status failed: ${message}`);
      setError(message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = Boolean(status?.running);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void gitApi.getLocalSyncServerStatus().then(setStatus).catch(() => {});
    }, 4000);
    return () => window.clearInterval(timer);
  }, [running]);

  const toggle = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = status?.running
        ? await gitApi.stopLocalSyncServer()
        : await gitApi.startLocalSyncServer();
      console.log(`[local-sync:ui] toggled server: ${statusForLog(next)}`);
      setStatus(next);
    } catch (cause) {
      const message = getErrorMessage(cause);
      console.log(`[local-sync:ui] toggle failed: ${message}`);
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [status?.running]);

  return { status, busy, error, refresh, toggle };
}
