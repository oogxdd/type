// Shared format for the `type2://sync` deep link used to hand a sync remote
// from a desktop QR code to the phone. The desktop builds it (encoded in a QR);
// the phone's deep-link handler parses it after the native Camera opens the app.
//
// Format: type2://sync?remote=<url-encoded remote>&branch=<branch>&name=<label>

export const SYNC_DEEP_LINK_SCHEME = "type2";

export type SyncDeepLinkParams = {
  remote: string;
  branch?: string;
  name?: string;
};

export function buildSyncDeepLink(params: SyncDeepLinkParams): string {
  const query = new URLSearchParams();
  query.set("remote", params.remote);
  if (params.branch) query.set("branch", params.branch);
  if (params.name) query.set("name", params.name);
  return `${SYNC_DEEP_LINK_SCHEME}://sync?${query.toString()}`;
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
  const query = new URLSearchParams(queryStart === -1 ? "" : rest.slice(queryStart + 1));
  const remote = query.get("remote")?.trim();
  if (!remote) {
    return null;
  }
  return {
    remote,
    branch: query.get("branch")?.trim() || undefined,
    name: query.get("name")?.trim() || undefined,
  };
}
