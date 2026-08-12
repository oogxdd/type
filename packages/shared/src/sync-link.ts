// Shared format for the `type2://sync` deep link used to hand a sync remote
// from a desktop QR code to the phone. The desktop builds it (encoded in a QR);
// the phone parses it — either from its in-app QR scanner or from the OS
// deep-link handler after the native Camera opens the app.
//
// A link contains either the legacy Git remote, or an encrypted iroh-docs
// trusted-device bundle. The vault key is intentionally handed only to a
// trusted device; the optional storage peer receives a separate read ticket.
//
// Query handling is hand-rolled: React Native's built-in URLSearchParams is
// incomplete (get() throws), and this package carries no DOM lib.

export const SYNC_DEEP_LINK_SCHEME = "type2";

export type SyncDeepLinkParams = {
  remote?: string;
  branch?: string;
  name?: string;
  hostKeySha256?: string;
  /** Optional Iroh endpoint ticket for the SSH-over-Iroh transport. */
  irohTicket?: string;
  irohDocTicket?: string;
  irohVaultKey?: string;
  irohPeerTicket?: string;
};

export function buildSyncDeepLink(params: SyncDeepLinkParams): string {
  const pairs: string[] = [];
  if (params.remote) pairs.push(`remote=${encodeURIComponent(params.remote)}`);
  if (params.branch) pairs.push(`branch=${encodeURIComponent(params.branch)}`);
  if (params.name) pairs.push(`name=${encodeURIComponent(params.name)}`);
  if (params.hostKeySha256) {
    pairs.push(`hostKeySha256=${encodeURIComponent(params.hostKeySha256)}`);
  }
  if (params.irohTicket) pairs.push(`irohTicket=${encodeURIComponent(params.irohTicket)}`);
  if (params.irohDocTicket) {
    pairs.push(`irohDocTicket=${encodeURIComponent(params.irohDocTicket)}`);
  }
  if (params.irohVaultKey) {
    pairs.push(`irohVaultKey=${encodeURIComponent(params.irohVaultKey)}`);
  }
  if (params.irohPeerTicket) {
    pairs.push(`irohPeerTicket=${encodeURIComponent(params.irohPeerTicket)}`);
  }
  return `${SYNC_DEEP_LINK_SCHEME}://sync?${pairs.join("&")}`;
}

/** Also accepts `+` for space, as URLSearchParams-built links encoded it. */
function decodeQueryComponent(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/\+/g, "%20"));
  } catch {
    return null;
  }
}

function parseQuery(query: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
    const key = decodeQueryComponent(rawKey);
    const value = decodeQueryComponent(rawValue);
    if (key !== null && value !== null && !params.has(key)) {
      params.set(key, value);
    }
  }
  return params;
}

export function parseSyncDeepLink(url: string): SyncDeepLinkParams | null {
  const prefix = `${SYNC_DEEP_LINK_SCHEME}://`;
  if (!url.toLowerCase().startsWith(prefix)) {
    return null;
  }
  const rest = url.slice(prefix.length); // e.g. "sync?remote=..."
  const queryStart = rest.indexOf("?");
  const host = (queryStart === -1 ? rest : rest.slice(0, queryStart)).replace(/\/+$/, "");
  if (host.toLowerCase() !== "sync") {
    return null;
  }
  const query = parseQuery(queryStart === -1 ? "" : rest.slice(queryStart + 1));
  const remote = query.get("remote")?.trim() || undefined;
  const irohDocTicket = query.get("irohDocTicket")?.trim() || undefined;
  const irohVaultKey = query.get("irohVaultKey")?.trim() || undefined;
  if (!remote && !(irohDocTicket && irohVaultKey)) {
    return null;
  }
  return {
    remote,
    branch: query.get("branch")?.trim() || undefined,
    name: query.get("name")?.trim() || undefined,
    hostKeySha256: query.get("hostKeySha256")?.trim() || undefined,
    irohTicket: query.get("irohTicket")?.trim() || undefined,
    irohDocTicket,
    irohVaultKey,
    irohPeerTicket: query.get("irohPeerTicket")?.trim() || undefined,
  };
}

/** Pairing usernames are only for first auth; paired keys work under any user. */
export function stripPairingUsernameFromSshRemote(remote: string): string {
  return remote.replace(/^ssh:\/\/pair-[^@/?#]+@/i, "ssh://");
}
