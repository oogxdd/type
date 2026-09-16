import { beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "@typenotes/mobile-core/core-api";
import { createMockCore } from "@typenotes/mobile-core/mock-core";
import { setRawCore } from "@typenotes/mobile-core/raw-core";
import { useNotesStore } from "./notes-store";
import { useSyncStore } from "./sync-store";

vi.mock("./settings-store", () => ({
  activeProfile: () => ({ settings: {
    git_remote_url: "ssh://127.0.0.1:19418/notes", git_branch: "main",
    git_username: "", git_password: "", git_iroh_ticket: "",
  } }),
  useSettingsStore: { getState: () => ({ snapshot: null }) },
}));
vi.mock("./notes-store", () => ({
  useNotesStore: { getState: () => ({ refresh: refreshNotes }) },
}));
const { refreshNotes } = vi.hoisted(() => ({ refreshNotes: vi.fn() }));
vi.mock("./diagnostics-store", () => ({
  useDiagnosticsStore: { getState: () => ({ diagnostics: { captureSyncLogs: false } }) },
}));

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

describe("mobile sync coordination", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    refreshNotes.mockReset().mockResolvedValue(undefined);
    const raw = createMockCore();
    await raw.initCore("/tmp/type-sync-test", "/tmp");
    setRawCore(raw);
    const status = {
      git_available: true, repo_initialized: true, current_branch: "main",
      remote_url: "ssh://127.0.0.1:19418/notes", has_uncommitted_changes: false,
      push_required: true, ahead: 1, behind: 0, notes_root: "/tmp/type-sync-test",
    };
    vi.spyOn(core, "getGitStatus").mockResolvedValue(status);
    vi.spyOn(core, "gitPull").mockResolvedValue(status);
    vi.spyOn(core, "gitPush").mockResolvedValue({ ...status, ahead: 0, push_required: false });
    vi.spyOn(core, "getGitHistory").mockResolvedValue([]);
    vi.spyOn(core, "pruneMobileAudioCache").mockResolvedValue({
      scanned: 0, evicted: 0, already_evicted: 0, waiting_for_age: 0,
      waiting_for_transcription: 0, waiting_for_desktop_receipt: 0, waiting_for_git_migration: 0,
    });
    useSyncStore.setState({ action: "idle", status: null, error: null, autoSyncState: null });
  });

  it("joins concurrent syncs and blocks refresh/pull until notes refresh and push finish", async () => {
    const notes = deferred();
    const entered = deferred();
    refreshNotes.mockImplementationOnce(() => { entered.resolve(); return notes.promise; });
    const first = useSyncStore.getState().syncNow();
    // Also covers the gap before the first asynchronous HEAD read.
    const second = useSyncStore.getState().syncNow();
    expect(second).toBe(first);
    await entered.promise;
    await useSyncStore.getState().refresh();
    await useSyncStore.getState().pull();
    expect(core.getGitStatus).toHaveBeenCalledTimes(1);
    expect(core.gitPull).toHaveBeenCalledTimes(1);
    expect(core.gitPush).not.toHaveBeenCalled();
    expect(useSyncStore.getState().autoSyncState).toBe("syncing");
    notes.resolve();
    await Promise.all([first, second]);
    expect(core.gitPush).toHaveBeenCalledTimes(1);
    expect(core.getGitStatus).toHaveBeenCalledTimes(1);
    expect(useSyncStore.getState().autoSyncState).toBe("synced");
  });

  it("pushes notes before cache maintenance and does not wait for maintenance", async () => {
    const maintenance = deferred();
    vi.mocked(core.pruneMobileAudioCache).mockImplementationOnce(async () => {
      expect(core.gitPush).toHaveBeenCalledTimes(1);
      await maintenance.promise;
      return { scanned: 0, evicted: 0, already_evicted: 0, waiting_for_age: 0,
        waiting_for_transcription: 0, waiting_for_desktop_receipt: 0, waiting_for_git_migration: 0 };
    });
    await useSyncStore.getState().syncNow();
    expect(core.pruneMobileAudioCache).toHaveBeenCalledTimes(1);
    expect(useSyncStore.getState().autoSyncState).toBe("synced");
    maintenance.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("releases the workflow after failure and allows retry without reporting success", async () => {
    vi.mocked(core.gitPull).mockRejectedValueOnce(new Error("offline"));
    await expect(useSyncStore.getState().syncNow()).rejects.toThrow("offline");
    expect(core.gitPush).not.toHaveBeenCalled();
    expect(useSyncStore.getState().autoSyncState).toBe("waiting_for_computer");
    await useSyncStore.getState().syncNow();
    expect(core.gitPush).toHaveBeenCalledTimes(1);
    expect(useSyncStore.getState().autoSyncState).toBe("synced");
  });

  it("reserves standalone pull before its first HEAD read", async () => {
    const head = deferred();
    vi.mocked(core.getGitHistory).mockImplementationOnce(async () => { await head.promise; return []; });
    const pull = useSyncStore.getState().pull();
    await useSyncStore.getState().pull();
    await useSyncStore.getState().refresh();
    expect(core.getGitHistory).toHaveBeenCalledTimes(1);
    head.resolve();
    await pull;
    expect(core.gitPull).toHaveBeenCalledTimes(1);
    expect(useNotesStore.getState().refresh).toHaveBeenCalledTimes(1);
  });
});
