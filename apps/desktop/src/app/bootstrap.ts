// App bootstrap: starts the store-based state layer and wires the
// cross-domain reactions that used to live in provider effects. Called once
// from mountApp(), before React renders — stores are module singletons, so
// nothing here depends on the component tree.
import { initAppearancePersistence } from "@/state/appearance-store";
import { resetSelection } from "@/state/selection-store";
import { APP_EXTENSIONS } from "@/lib/extensions";
import { initEditor } from "@/state/editor-store";
import { initGitSync } from "@/state/git-sync-store";
import { initHandwriting } from "@/state/handwriting-store";
import { initNotes } from "@/state/notes-actions";
import { initRecordings } from "@/state/recordings-store";
import {
  initProfiles,
  selectActiveProfileId,
  selectActiveProfileNotesRoot,
  useProfilesStore,
} from "@/state/profiles-store";
import {
  initSecurity,
  selectIsLocked,
  useSecurityStore,
} from "@/state/security-store";

let started = false;

export function bootstrapApp() {
  if (started) {
    return;
  }
  started = true;

  initAppearancePersistence();
  initSecurity();
  // Editor lifecycle must react to profile switches before the selection
  // reset below fires, so it registers its subscriptions first.
  initEditor();
  initNotes();
  initGitSync();
  // The capture queue loops self-gate on lock state and profile readiness.
  initRecordings();
  initHandwriting();

  // Selection belongs to a profile root and must never leak across a switch.
  useProfilesStore.subscribe((state, previous) => {
    const activeProfileId = selectActiveProfileId(state);
    if (!activeProfileId) {
      return;
    }
    if (
      activeProfileId !== selectActiveProfileId(previous) ||
      selectActiveProfileNotesRoot(state) !== selectActiveProfileNotesRoot(previous)
    ) {
      resetSelection();
    }
  });

  startDataDomains();
}

// The backend rejects content commands while encrypted-and-locked, so the
// data domains load on every locked→unlocked transition, not just at boot.
// With the security extension off the lock screen never renders and data
// loads immediately (matching the old always-mounted provider behavior).
function startDataDomains() {
  if (!APP_EXTENSIONS.security) {
    void initProfiles();
    return;
  }

  let wasUnlocked = false;
  const startIfUnlocked = () => {
    const state = useSecurityStore.getState();
    if (!state.securityState) {
      return;
    }
    const unlocked = !selectIsLocked(state);
    if (unlocked && !wasUnlocked) {
      void initProfiles();
    }
    wasUnlocked = unlocked;
  };

  startIfUnlocked();
  useSecurityStore.subscribe(startIfUnlocked);
}
