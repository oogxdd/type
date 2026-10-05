import { configureResponsivenessTrace, startResponsivenessHeartbeat } from "../lib/responsiveness-trace";
import { runWithFixtureDelay } from "../core/performance-fixture";
import { AppState } from "react-native";
import { setCoreCallRunner } from "@typenotes/mobile-core/raw-core";
import { bootCore } from "../core/boot";
import { mobileRuntime } from "../core/runtime";
import { useAppearanceStore } from "./appearance-store";
import { useDiagnosticsStore } from "./diagnostics-store";
import { useNotesStore } from "./notes-store";
import { activeProfile, useSettingsStore } from "./settings-store";
import { isLocked, useSecurityStore } from "./security-store";
import { useSyncStore } from "./sync-store";
import { useRecordingSessionStore } from "./recording-session-store";
import { useBackgroundOperationStore } from "./background-operation-store";
import { runPreSuspendSync } from "./pre-suspend-sync";

// Root changes and security transitions are owned by the lifecycle barrier.
const lifecycleCalls = new Set(["initCore", "getProfiles", "createProfile", "setActiveProfile", "setProfileNotesRoot", "getSecurityState", "lockSecurity", "unlockSecurity", "enableSecurity", "setSecurityPreferences", "sealDraft", "openDraft", "getGitSyncProgress"]);

/** Install once per application mount; screens never own these subscriptions. */
export const startMobileLifecycle = () => {
  mobileRuntime.onSaved = (reason, timing) => useSyncStore.getState().scheduleAutoSync(reason, timing);
  mobileRuntime.onSyncChanges = (result) => useNotesStore.getState().applySyncChanges(result);
  mobileRuntime.onRefreshNotes = () => useNotesStore.getState().refresh();
  mobileRuntime.onNotesChanged = (path, exists) => exists ? useNotesStore.getState().noteFiled(path) : useNotesStore.getState().noteRemoved(path);
  const draftWrites = new Set(["createNote", "writeNote", "writeNoteChecked", "deleteNoteChecked"]);
  setCoreCallRunner((method, run) => lifecycleCalls.has(method) ? run() : mobileRuntime.track(() => runWithFixtureDelay(method, run), undefined, draftWrites.has(method)));
  let stopHeartbeat: (() => void) | null = null;
  const updateTrace = () => {
    stopHeartbeat?.(); stopHeartbeat = null;
    const enabled = useDiagnosticsStore.getState().diagnostics.traceResponsiveness && AppState.currentState === "active";
    configureResponsivenessTrace(enabled);
    if (enabled) stopHeartbeat = startResponsivenessHeartbeat();
  };
  updateTrace();
  const unsubscribeDiagnostics = useDiagnosticsStore.subscribe(updateTrace);
  let backgroundLockDeferred = false;
  const protectedOperationActive = () => useRecordingSessionStore.getState().active || useBackgroundOperationStore.getState().count > 0;
  const lockIfEnabled = () => {
    const security = useSecurityStore.getState();
    if (security.state?.encryption_enabled && security.state.auto_lock_on_background) void security.lock();
  };
  const applyWorkspace = () => {
    const profile = activeProfile(useSettingsStore.getState().snapshot);
    mobileRuntime.setWorkspace(profile?.id ?? null, profile?.notes_root ?? null);
  };
  applyWorkspace();
  const unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
    const before = activeProfile(previous.snapshot), next = activeProfile(state.snapshot);
    if (before?.id === next?.id && before?.notes_root === next?.notes_root) return;
    applyWorkspace();
    useSyncStore.getState().resetForWorkspace();
    if (before && !isLocked(useSecurityStore.getState().state)) {
      const token = mobileRuntime.workspace();
      void mobileRuntime.whenWorkspaceReady().then(() => {
        if (!mobileRuntime.isCurrent(token) || isLocked(useSecurityStore.getState().state)) return;
        void mobileRuntime.onRefreshNotes();
        mobileRuntime.onSaved("working folder changed", "now");
      }).catch(mobileRuntime.saveError);
    }
  });
  const subscription = AppState.addEventListener("change", (next) => {
    updateTrace();
    const locked = isLocked(useSecurityStore.getState().state);
    if (next === "active") {
      backgroundLockDeferred = false;
      if (!locked) mobileRuntime.onSaved("app foregrounded", "now");
    } else if (next === "background" && !locked) {
      runPreSuspendSync();
      if (protectedOperationActive()) backgroundLockDeferred = true;
      else lockIfEnabled();
    }
  });
  const finishDeferredLock = () => {
    if (backgroundLockDeferred && !protectedOperationActive() && AppState.currentState !== "active") {
      backgroundLockDeferred = false;
      lockIfEnabled();
    }
  };
  const unsubscribeRecording = useRecordingSessionStore.subscribe(finishDeferredLock);
  const unsubscribeBackground = useBackgroundOperationStore.subscribe(finishDeferredLock);
  return () => {
    subscription.remove(); unsubscribeSettings(); unsubscribeRecording(); unsubscribeBackground();
    unsubscribeDiagnostics(); stopHeartbeat?.(); configureResponsivenessTrace(false);
    setCoreCallRunner(null);
  };
};

export const bootMobile = async () => {
  await useAppearanceStore.getState().load();
  await useDiagnosticsStore.getState().load();
  const { demoMode } = await bootCore();
  useSettingsStore.getState().setDemoMode(demoMode);
  await useSecurityStore.getState().load();
  if (!isLocked(useSecurityStore.getState().state)) {
    await useSettingsStore.getState().load();
    void mobileRuntime.onRefreshNotes();
    // A configured sync obtains its own final status; do not occupy its slot
    // with a startup worktree scan. Unconfigured installs still show status.
    const profile = activeProfile(useSettingsStore.getState().snapshot);
    if (!profile?.settings.git_remote_url?.trim()) void useSyncStore.getState().refresh().catch(() => {});
    mobileRuntime.onSaved("app opened", "now");
  }
};
