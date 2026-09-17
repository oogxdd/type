import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteReadQueue } from "./note-read-queue";

afterEach(() => vi.useRealTimers());
describe("large note selections", () => {
  it("reads 150 notes with at most three in flight and prioritizes a visible note", async () => {
    vi.useFakeTimers();
    const queue = new NoteReadQueue();
    const started: number[] = [];
    let active = 0, maximum = 0;
    const reads = Array.from({ length: 150 }, (_, i) => queue.read(String(i), async () => {
      started.push(i); maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return String(i);
    }));
    queue.prioritize("149");
    await vi.runAllTimersAsync();
    expect(await Promise.all(reads)).toHaveLength(150);
    expect(maximum).toBe(3);
    expect(started.slice(0, 4)).toEqual([0, 1, 2, 149]);
  });
  it("drops queued work on navigation without blocking the next selection", async () => {
    vi.useFakeTimers();
    const queue = new NoteReadQueue(1);
    const obsolete = vi.fn(async () => "obsolete");
    const first = queue.read("old", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "first";
    });
    const cancelled = queue.read("obsolete", obsolete);
    queue.cancelExcept(new Set(["next"]));
    const next = queue.read("next", async () => "next", true);
    await vi.runAllTimersAsync();
    expect(await first).toBe("first");
    expect(await cancelled).toBeUndefined();
    expect(await next).toBe("next");
    expect(obsolete).not.toHaveBeenCalled();
  });
});
