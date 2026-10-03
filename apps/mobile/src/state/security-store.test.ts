import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLocked, useSecurityStore } from "./security-store";
import { useSettingsStore } from "./settings-store";
import * as core from "@typenotes/mobile-core/core-api";

vi.mock("@typenotes/mobile-core/core-api", () => ({
  unlockSecurity: vi.fn(),
  getSecurityState: vi.fn(),
}));
vi.mock("./notes-store", () => ({
  useNotesStore: { getState: () => ({ refresh: vi.fn(async () => {}) }) },
}));

describe("unlock startup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSecurityStore.setState({
      state: { encryption_enabled: true, locked: true, auto_lock_on_background: true },
      error: null, busy: false,
    });
    vi.mocked(core.unlockSecurity).mockResolvedValue({ unlocked: true, panic_triggered: false, reset_required: false, message: null });
    vi.mocked(core.getSecurityState).mockResolvedValue({
      encryption_enabled: true, locked: false, auto_lock_on_background: true,
    });
  });

  it("keeps Home unmounted until the active profile is loaded", async () => {
    let finish!: () => void;
    const profileLoad = new Promise<void>((resolve) => { finish = resolve; });
    const load = vi.spyOn(useSettingsStore.getState(), "load").mockReturnValue(profileLoad);
    const unlocking = useSecurityStore.getState().unlock("synthetic-password");
    await vi.waitFor(() => expect(load).toHaveBeenCalled());
    expect(isLocked(useSecurityStore.getState().state)).toBe(true);
    finish();
    await unlocking;
    expect(isLocked(useSecurityStore.getState().state)).toBe(false);
  });

  it("does not mount a workspace with missing settings after a load failure", async () => {
    vi.spyOn(useSettingsStore.getState(), "load").mockRejectedValue(new Error("Read failed"));
    await useSecurityStore.getState().unlock("synthetic-password");
    expect(isLocked(useSecurityStore.getState().state)).toBe(true);
    expect(useSecurityStore.getState().error).toBe("Read failed");
  });
});
