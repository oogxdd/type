import { expect, it } from "vitest";
import { NoteJobScheduler } from "./note-job-scheduler";

it("coalesces queued feed work, retaining its tree input and prioritizing cache updates", async () => {
  let finish!: () => void;
  const blocked = new Promise<void>((resolve) => { finish = resolve; });
  const calls: string[] = [];
  const scheduler = new NoteJobScheduler(async (job) => {
    calls.push(job.kind);
    if (calls.length === 1) await blocked;
    if (job.kind === "feed") expect(job.notes).toHaveLength(1);
    return {};
  });
  const first = scheduler.run({ kind: "snapshot", scope: "test" });
  const obsolete = scheduler.run({ kind: "feed", scope: "test", key: "menu", filter: "all", now: 1, notes: [{ path: "a.md", name: "a.md" }] });
  const latest = scheduler.run({ kind: "feed", scope: "test", key: "menu", filter: "active", now: 2 });
  const update = scheduler.run({ kind: "update", scope: "test", changes: [], removed: [] });
  await expect(obsolete).resolves.toEqual({});
  finish();
  await Promise.all([first, latest, update]);
  expect(calls).toEqual(["snapshot", "update", "feed"]);
});
