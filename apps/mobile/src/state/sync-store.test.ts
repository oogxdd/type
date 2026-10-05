import { mobileRuntime } from "../core/runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "@typenotes/mobile-core/core-api";
import { createMockCore } from "@typenotes/mobile-core/mock-core";
import { setRawCore } from "@typenotes/mobile-core/raw-core";
import { useNotesStore } from "./notes-store";
import { useSyncStore } from "./sync-store";

const { profileSettings } = vi.hoisted(() => ({ profileSettings: {
  git_remote_url: "ssh://127.0.0.1:19418/notes", git_branch: "main",
  git_username: "", git_password: "", git_iroh_ticket: "",
} }));
vi.mock("./settings-store", () => ({
  activeProfile: () => ({ settings: profileSettings }),
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
    vi.spyOn(core, "supportsGitSyncCycle").mockReturnValue(false);
    mobileRuntime.onRefreshNotes = () => useNotesStore.getState().refresh();
    profileSettings.git_iroh_ticket = "";
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

  it("joins concurrent syncs through push without waiting for note previews", async () => {
    const notes = deferred();
    const entered = deferred();
    const pushed = deferred();
    vi.mocked(core.gitPush).mockImplementationOnce(async () => { await pushed.promise; return { ...(await core.getGitStatus()), ahead: 0, push_required: false }; });
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
    await vi.waitFor(() => expect(core.gitPush).toHaveBeenCalledTimes(1));
    expect(useSyncStore.getState().autoSyncState).toBe("syncing");
    pushed.resolve();
    await Promise.all([first, second]);
    expect(core.gitPush).toHaveBeenCalledTimes(1);
    expect(core.getGitStatus).toHaveBeenCalledTimes(2);
    expect(useSyncStore.getState().autoSyncState).toBe("synced");
    notes.resolve();
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

  it("keeps an edit made during push owed instead of reporting it synced", async () => {
    vi.useFakeTimers();
    const pushing = deferred();
    vi.mocked(core.gitPush).mockImplementationOnce(async () => { await pushing.promise; return await core.getGitStatus(); });
    try {
      const sync = useSyncStore.getState().syncNow();
      await vi.advanceTimersByTimeAsync(0);
      expect(core.gitPush).toHaveBeenCalledOnce();
      useSyncStore.getState().scheduleAutoSync("capture saved", "edit");
      pushing.resolve();
      await sync;
      expect(useSyncStore.getState().autoSyncState).toBe("saved_locally");
      useSyncStore.getState().resetForWorkspace();
    } finally { vi.useRealTimers(); }
  });

  it("keeps unpaired Iroh audio excluded while notes still sync", async () => {
    profileSettings.git_iroh_ticket = "ticket";
    const exclusion = vi.spyOn(core, "setMobileAudioGitExclusion");
    vi.spyOn(core, "archiveMobileAudioWithIroh").mockResolvedValue({
      scanned: 1, uploaded: 0, already_archived: 0, skipped: 1, failed: 0, error: "not paired",
    });
    await useSyncStore.getState().syncNow();
    expect(core.gitPush).toHaveBeenCalledTimes(1);
    expect(exclusion.mock.calls.every(([enabled]) => enabled)).toBe(true);
    expect(useSyncStore.getState().audioArchiveState).toBe("error");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("does not commit or push if excluding Iroh audio fails", async () => {
    profileSettings.git_iroh_ticket = "ticket";
    vi.spyOn(core, "setMobileAudioGitExclusion").mockRejectedValue(new Error("exclude write failed"));
    await expect(useSyncStore.getState().syncNow()).rejects.toThrow("exclude write failed");
    expect(core.gitPull).not.toHaveBeenCalled();
    expect(core.gitPush).not.toHaveBeenCalled();
    expect(useSyncStore.getState().autoSyncState).toBe("waiting_for_computer");
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
  it("syncs an edit still waiting for its typing pause before suspension", async () => {
    vi.useFakeTimers();
    try {
      useSyncStore.getState().scheduleAutoSync("capture saved", "edit");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(core.gitPush).not.toHaveBeenCalled();
      await useSyncStore.getState().syncBeforeSuspend();
      expect(core.gitPush).toHaveBeenCalledTimes(1);
      // The owed timer is gone, so nothing syncs again later.
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(core.gitPush).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing before suspension when nothing is owed", async () => {
    useSyncStore.setState({ autoSyncState: "synced" });
    await useSyncStore.getState().syncBeforeSuspend();
    expect(core.gitPull).not.toHaveBeenCalled();
  });
});

describe("unified native sync", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mobileRuntime.onSyncChanges = vi.fn().mockResolvedValue(undefined);
    profileSettings.git_iroh_ticket = "";
    vi.spyOn(core, "supportsGitSyncCycle").mockReturnValue(true);
    vi.spyOn(core, "getGitStatus");
    vi.spyOn(core, "gitPull");
    vi.spyOn(core, "gitPush");
    vi.spyOn(core, "getGitHistory").mockResolvedValue([]);
    vi.spyOn(core, "pruneMobileAudioCache").mockResolvedValue({ scanned: 0, evicted: 0, already_evicted: 0, waiting_for_age: 0, waiting_for_transcription: 0, waiting_for_desktop_receipt: 0, waiting_for_git_migration: 0 });
    useSyncStore.getState().resetForWorkspace();
  });
  const result = () => ({
    status: { git_available: true, repo_initialized: true, current_branch: "main", remote_url: profileSettings.git_remote_url, has_uncommitted_changes: false, push_required: false, ahead: 0, behind: 0, notes_root: "/tmp/type-sync-test" },
    changed_paths: ["_system/stream/incoming.md"], reset_required: false, tree_patch: [], entries: [], removed_paths: [], push_error: null as string | null,
  });

  it("joins one native workflow with no preliminary status and no preview wait", async () => {
    const native = deferred(), previews = deferred();
    const call = vi.spyOn(core, "gitSyncCycle").mockImplementation(async () => { await native.promise; return result(); });
    vi.mocked(mobileRuntime.onSyncChanges).mockImplementation(() => previews.promise);
    const first = useSyncStore.getState().syncNow();
    expect(useSyncStore.getState().syncNow()).toBe(first);
    await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
    native.resolve();
    await first;
    expect(mobileRuntime.onSyncChanges).toHaveBeenCalledOnce();
    expect(core.getGitStatus).not.toHaveBeenCalled();
    expect(core.gitPull).not.toHaveBeenCalled();
    expect(core.gitPush).not.toHaveBeenCalled();
    expect(useSyncStore.getState().autoSyncState).toBe("synced");
    previews.resolve();
  });

  it("does not rebuild previews for a local-only commit or a no-change cycle", async () => {
    vi.spyOn(core, "gitSyncCycle").mockResolvedValue({ ...result(), changed_paths: [] });
    await useSyncStore.getState().syncNow();
    expect(mobileRuntime.onSyncChanges).not.toHaveBeenCalled();
  });

  it("publishes successfully received changes even when sending failed", async () => {
    vi.spyOn(core, "gitSyncCycle").mockResolvedValue({ ...result(), push_error: "server refused send" });
    await expect(useSyncStore.getState().syncNow()).rejects.toThrow("server refused send");
    expect(mobileRuntime.onSyncChanges).toHaveBeenCalledOnce();
    expect(useSyncStore.getState().autoSyncState).toBe("waiting_for_computer");
  });

  it("keeps edits arriving after the native commit owed", async () => {
    vi.useFakeTimers();
    try {
      const native = deferred();
      vi.spyOn(core, "gitSyncCycle").mockImplementation(async () => { await native.promise; return result(); });
      const sync = useSyncStore.getState().syncNow();
      await vi.advanceTimersByTimeAsync(0);
      useSyncStore.getState().scheduleAutoSync("capture saved", "edit");
      native.resolve(); await sync;
      expect(useSyncStore.getState().autoSyncState).toBe("saved_locally");
      useSyncStore.getState().resetForWorkspace();
    } finally { vi.useRealTimers(); }
  });
  it("schedules native edits that arrived after its commit for another cycle", async () => {
    vi.useFakeTimers();
    try {
      const value = result();
      value.status.has_uncommitted_changes = true;
      vi.spyOn(core, "gitSyncCycle").mockResolvedValue(value);
      await useSyncStore.getState().syncNow();
      expect(useSyncStore.getState().autoSyncState).toBe("saved_locally");
      useSyncStore.getState().resetForWorkspace();
    } finally { vi.useRealTimers(); }
  });

});
