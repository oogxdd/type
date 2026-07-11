// App bootstrap: starts the store-based state layer and wires the
// cross-domain reactions that used to live in provider effects. Called once
// from mountApp(), before React renders — stores are module singletons, so
// nothing here depends on the component tree.
import { initAppearancePersistence } from "@/app/state/appearance-store";
import { useSelection } from "@/app/state/selection-store";
import { APP_EXTENSIONS } from "@/features/extensions/registry";
import { initEditor } from "@/features/notes/editor/state/editor-store";
import {
  initProfiles,
  selectActiveProfileId,
  selectActiveProfileNotesRoot,
  useProfilesStore,
} from "@/features/profiles/state/profiles-store";
import {
  initSecurity,
  selectIsLocked,
  useSecurityStore,
} from "@/features/security/state/security-store";

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
      useSelection.getState().resetSelection();
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
