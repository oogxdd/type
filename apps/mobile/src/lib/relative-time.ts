// Short relative-time labels for compact UI (e.g. "last synced" in the drawer).

export const formatRelativeTime = (ms: number | null): string => {
  if (!ms) {
    return "never";
  }
  const diffMs = Date.now() - ms;
  if (diffMs < 0) {
    return "just now";
  }
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });
};
