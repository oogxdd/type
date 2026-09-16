/** Creation time, matching Feed chronology; always include local 24-hour time. */
export function formatEditorDate(timestamp: number | null, now = new Date()): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const day = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const daysAgo = (day(now) - day(date)) / 86_400_000;
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (daysAgo === 0) return `Today ${time}`;
  if (daysAgo === 1) return `Yesterday ${time}`;
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long" });
  if (daysAgo > 1 && daysAgo < 7) return `${weekday} ${time}`;
  const month = date.toLocaleDateString("en-GB", { month: "short" });
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${weekday} ${date.getDate()} ${month}${year} ${time}`;
}
