import { describe, expect, it, vi } from "vitest";
import { RecordingSession, type PendingRecording, type RecordingSessionDeps } from "./recording-session";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const fixture = () => {
  const saved = deferred<string>();
  const journal = new Map<string, PendingRecording>();
  let next = 0, holds = 0, started: number | null = null;
  const deps: RecordingSessionDeps = {
    prepare: vi.fn(async () => {}),
    makePending: () => ({ id: String(++next), uri: `file:///${next}.wav`, profileId: "synthetic", notesRoot: "/synthetic", mimeType: "audio/wav", startedAt: next }),
    remember: (clip) => { journal.set(clip.id, { ...clip }); },
    record: vi.fn(), pause: vi.fn(), stop: vi.fn(async () => {}),
    save: vi.fn(() => saved.promise), forget: vi.fn((clip) => { journal.delete(clip.id); }),
    hold: () => { holds++; return () => { holds--; }; },
    changed: (time) => { started = time; }, saved: vi.fn(), error: vi.fn(),
  };
  const session = new RecordingSession(deps);
  return { session, deps, saved, journal, holds: () => holds, started: () => started };
};

describe("recording session", () => {
  it("starts a warm recorder in the tap and journals before native capture", async () => {
    const f = fixture();
    await f.session.warm();
    f.deps.record = vi.fn(() => { expect(f.journal.size).toBe(1); });
    void f.session.start();
    expect(f.deps.record).toHaveBeenCalledOnce();
    expect(f.started()).toBe(1);
  });

  it("cuts capture and updates feedback synchronously, allowing another recording during saving", async () => {
    const f = fixture();
    await f.session.warm(); await f.session.start();
    const stop = f.session.stop();
    expect(f.deps.pause).toHaveBeenCalledOnce();
    expect(f.started()).toBeNull();
    await stop;
    await f.session.warm(); await f.session.start();
    expect(f.started()).toBe(2);
    expect(f.holds()).toBe(2);
    f.saved.resolve("saved.md");
    await f.session.import([...f.journal.values()][0]);
    expect(f.holds()).toBe(1); // The second recording keeps auto-lock deferred.
    expect(f.journal.has("1")).toBe(false);
    expect(f.journal.has("2")).toBe(true);
  });

  it("joins button, interruption and lock-screen stops exactly once", async () => {
    const f = fixture(); await f.session.start();
    const one = f.session.stop(); const two = f.session.stop(true);
    expect(one).toBe(two); await one;
    expect(f.deps.stop).toHaveBeenCalledOnce();
    expect(f.deps.save).toHaveBeenCalledOnce();
  });

  it("honors a stop tapped before native preparation completes", async () => {
    const f = fixture(), prepared = deferred<void>();
    f.deps.prepare = () => prepared.promise;
    const start = f.session.start(), stop = f.session.stop();
    prepared.resolve(); await start; await stop;
    expect(f.deps.record).toHaveBeenCalledOnce();
    expect(f.deps.pause).toHaveBeenCalledOnce();
    expect(f.started()).toBeNull();
  });

  it("retains failed imports across process death and recovers into the pinned workspace", async () => {
    const f = fixture(); await f.session.start(); await f.session.stop();
    f.saved.reject(new Error("disk full"));
    const clip = [...f.journal.values()][0];
    await f.session.import(clip);
    expect(f.journal.size).toBe(1); expect(f.holds()).toBe(0);
    const recovered = fixture(); recovered.saved.resolve("recovered.md");
    await recovered.session.import(clip);
    expect(recovered.deps.save).toHaveBeenCalledWith(expect.objectContaining({ profileId: "synthetic", notesRoot: "/synthetic" }));
    expect(recovered.deps.forget).toHaveBeenCalledOnce();
  });

  it("retries cleanup without importing a successful note twice", async () => {
    const f = fixture(); f.saved.resolve("saved.md");
    f.deps.forget = vi.fn().mockImplementationOnce(() => { throw new Error("cleanup failed"); });
    await f.session.start(); await f.session.stop();
    const clip = [...f.journal.values()][0]; await f.session.import(clip);
    await f.session.import(clip);
    expect(f.deps.save).toHaveBeenCalledOnce();
    expect(f.deps.error).toHaveBeenCalledOnce();
    expect(f.holds()).toBe(0);
  });

  it("does not start after unmount while preparation is pending", async () => {
    const f = fixture(), prepared = deferred<void>(); f.deps.prepare = () => prepared.promise;
    const start = f.session.start(); f.session.dispose(); prepared.resolve(); await start;
    expect(f.deps.record).not.toHaveBeenCalled();
  });
});
