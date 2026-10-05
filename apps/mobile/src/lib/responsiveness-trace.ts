type Entry = { at: number; stage: string; elapsedMs?: number };
let enabled = false;
let entries: Entry[] = [];
let navigationStarted: number | null = null;
export const configureResponsivenessTrace = (value: boolean) => { enabled = value; navigationStarted = null; };
export const clearResponsivenessTrace = () => { entries = []; navigationStarted = null; };
export const recordResponsiveness = (stage: string, elapsedMs?: number) => {
  if (!enabled) return;
  entries.push({ at: Date.now(), stage, ...(elapsedMs == null ? {} : { elapsedMs: Math.round(elapsedMs) }) });
  if (entries.length > 500) entries.splice(0, entries.length - 500);
};
export const beginNavigationTrace = () => { if (enabled) navigationStarted = Date.now(); recordResponsiveness("navigation dispatch"); };
export const finishNavigationTrace = () => {
  if (navigationStarted == null) return;
  recordResponsiveness("navigation state changed", Date.now() - navigationStarted);
  navigationStarted = null;
};
export const exportResponsivenessTrace = () => {
  const timings = entries.filter((entry) => entry.stage === "navigation state changed").map((entry) => entry.elapsedMs!).sort((a, b) => a - b);
  const p95 = timings.length ? timings[Math.ceil(timings.length * 0.95) - 1] : null;
  return `Type responsiveness trace (JS dispatch → navigation state; not rendered-frame latency)\nSamples: ${timings.length}; p95: ${p95 ?? "unmeasured"}ms\n${entries.map((entry) => `${new Date(entry.at).toISOString()} ${entry.stage}${entry.elapsedMs == null ? "" : ` ${entry.elapsedMs}ms`}`).join("\n")}`;
};

/** Records JS stalls without React state updates, content, paths, or secrets. */
export const startResponsivenessHeartbeat = () => {
  let previous = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const lag = now - previous - 100;
    previous = now;
    if (lag > 50) recordResponsiveness("JS timer lag", lag);
  }, 100);
  return () => clearInterval(timer);
};
