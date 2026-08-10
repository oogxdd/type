import { describe, expect, it, vi } from "vitest";

import { startTranscription, type TranscriptionQueueDeps } from "./transcription-queue";

const makeDeps = (overrides: Partial<TranscriptionQueueDeps> = {}): TranscriptionQueueDeps => ({
  queueAssembly: vi.fn(async () => {}),
  queueNative: vi.fn(async () => {}),
  ...overrides,
});

describe("startTranscription", () => {
  it("queues the cloud backend for assemblyai", async () => {
    const deps = makeDeps();
    expect(await startTranscription("assemblyai", deps)).toBeNull();
    expect(deps.queueAssembly).toHaveBeenCalledTimes(1);
    expect(deps.queueNative).not.toHaveBeenCalled();
  });

  it("queues the on-device provider for native", async () => {
    const deps = makeDeps();
    expect(await startTranscription("native", deps)).toBeNull();
    expect(deps.queueNative).toHaveBeenCalledTimes(1);
    expect(deps.queueAssembly).not.toHaveBeenCalled();
  });

  it("queues nothing for the modes another device or the user drives", async () => {
    for (const mode of ["desktop", "off"] as const) {
      const deps = makeDeps();
      expect(await startTranscription(mode, deps)).toBeNull();
      expect(deps.queueAssembly).not.toHaveBeenCalled();
      expect(deps.queueNative).not.toHaveBeenCalled();
    }
  });

  it("returns the failure instead of throwing — the notes are already saved", async () => {
    const deps = makeDeps({
      queueAssembly: vi.fn(async () => {
        throw new Error("Add an AssemblyAI API key in Settings.");
      }),
    });

    expect(await startTranscription("assemblyai", deps)).toBe(
      "Add an AssemblyAI API key in Settings."
    );
  });
});
