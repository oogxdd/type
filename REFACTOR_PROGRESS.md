# Frontend refactor — progress & plan

> **Temporary file.** Tracks the in-flight frontend restructure. Delete once the
> refactor is merged. Backend (`src-tauri/`) is out of scope.

## Goal

Reorganize `src/` from the current messy mix (`components/` root, `desktop/`,
`mobile/`, `mobile/components/`, stray `src/tree/`) into a clean **feature-sliced**
layout with **thin platform shells** and **kebab-case** filenames.

## Decisions (confirmed with the user)

1. **Feature-sliced**: `src/features/<name>/` — each feature owns its components +
   hooks + utils together. Cross-cutting state stays in `contexts/`, IPC in `data/`.
2. **Shared features + thin shells**: feature UI is platform-agnostic; only the
   composition shells live in `desktop/` and `mobile/`. Settings becomes one feature
   with `desktop/` + `mobile/` variant subfolders. The redundant `mobile/components/`
   nesting is removed.
3. **kebab-case everything**: all files kebab-cased (`FoldersPanel.tsx` →
   `folders-panel.tsx`), matching the existing `components/ui/` folder.

## Conventions

- **Imports**: moved/rewritten files use the `@/` alias for cross-directory imports
  (`@/contexts/...`, `@/features/...`); same-folder imports stay relative (`./x`).
  The `@/` → `src/` alias is configured in `tsconfig.json`, `vite.config.ts`, and
  `vite.ota.config.ts`, so it is safe everywhere and survives future moves.
- **Safety net**: `npx tsc --noEmit` after every stage (≈8s; `noUnusedLocals` is on,
  so it flags broken *and* dangling imports). Must be clean before each commit.
- **Entry points stay at `src/` root**: `ota-bootstrap.ts` (index.html entry) and
  `main.tsx` (OTA bundle entry — referenced by `vite.ota.config.ts`, do NOT delete).
- Each stage = move + fix imports + `tsc` clean + commit + push.

## Target structure

```
src/
  main.tsx                 entry stub (OTA bundle entry) — stays
  ota-bootstrap.ts         entry stub (index.html entry) — stays
  app/                     composition root
    app.tsx                (was App.tsx)
    app-shell.tsx          (was AppShell.tsx)
    main-app.tsx           (was mainApp.tsx)
    error-boundary.tsx     (was components/ErrorBoundary.tsx)
    launch-screen.ts       (was utils/launchScreen.ts)
    app.css                (was App.css)
  contexts/                cross-cutting state (kebab-cased files)
  data/                    IPC layer (kebab-cased files)
  components/ui/           shadcn primitives (unchanged — already kebab)
  lib/utils.ts             cn() helper (unchanged)
  hooks/use-mobile.ts      shadcn breakpoint hook (used by ui/sidebar) — stays
  utils/                   cross-cutting helpers only (kebab-cased)
  types.ts  constants.ts   global types / constants (kebab where sensible)
  features/
    tree/                  folders-panel, tree-node, tree-row, nav-note-row,
                           recent-tree-node, use-drag-drop, use-keyboard-navigation,
                           tree-ops, dnd-tree, keyboard-coordinates, types
    editor/                note-editor, multi-note-lens, note-readonly-content,
                           recording-note-header, handwriting-note-header,
                           use-note-editor, markdown-editor, lens-backmatter,
                           note-annotations
    notes/                 note-row, use-note-previews
    settings/              sections.ts, use-settings-data.ts
      desktop/             settings-panel + 8 section components + local-sync-server-card
      mobile/              settings-screen + 7 section components + helpers
    security/              lock-screen
    recording/             use-audio-recorder
  desktop/                 desktop-shell, middle-pane, right-pane, app-sidebar
  mobile/                  mobile-shell, tablet-layout, navigation, types,
                           use-layout-mode, use-keyboard-insets
    hooks/                 use-mobile-navigation, use-action-sheets,
                           use-phone-nav-header, use-recent-buckets, use-edge-swipe
    ui/                    action-sheet, nav-bar, tab-bar, prompt-sheet, toast
    screens/               phone route screens (home/folders/notes/recent-date/
                           recording/editor/settings + index)
    views/                 reusable bodies used by screens + tablet
                           (folders/notes/editor/recent/recording)
```

## Staged checklist

- [x] **0. Setup** — branch `refactor-frontend-structure`, this doc. (README change stashed.)
- [x] **1. features/editor/** — editor components + headers + lens + useNoteEditor + editor utils ✅ tsc clean
- [x] **2. features/tree/** — tree components + useDragDrop + useKeyboardNavigation + src/tree/* + treeOps ✅ tsc clean (src/tree/ root removed)
- [x] **3. features/notes/** — note-row + use-note-previews ✅ tsc clean
- [x] **4. features/security/** — lock-screen ✅ tsc clean
- [x] **5. features/recording/** — use-audio-recorder ✅ tsc clean
- [x] **6. features/settings/** — desktop + mobile sections, sections.ts, use-settings-data ✅ tsc clean
      - `SettingsPanel` split: registry → `sections.ts`; panes → `desktop/settings-panel.tsx`.
      - `ThemeMode`/`NotesListMode` moved to `src/types.ts` (cross-cutting, not settings-only).
- [x] **7. desktop/** — kebab-rename shells + move app-sidebar ✅ tsc clean
- [x] **8. mobile/** — ui/ + screens/ + views/ + hooks/, flatten components/, move use-edge-swipe ✅ tsc clean
      - components/ removed: UI primitives → ui/, reusable bodies (Mobile*Screen) → views/ (*-view).
      - Phone* route screens → screens/ (*-screen). Cross-layer imports → @/, intra-mobile relative.
- [x] **9. app/** — App/AppShell/mainApp/ErrorBoundary/launchScreen + update entry stubs ✅ tsc clean
      - `src/components/` now contains only `ui/` (shadcn). Entry stubs (main.tsx,
        ota-bootstrap.ts) stay at src/ root, now import `./app/main-app`.
- [x] **10. contexts/** — kebab-rename ✅ tsc clean (theme-context, profiles-context, …)
- [x] **11. data/** — kebab-rename ✅ tsc clean (notes-api, git-api, …; invoke.ts unchanged)
- [x] **12. utils/ + constants/types** — final kebab pass ✅ no-op: all remaining files
      (utils/{dom,format,frontmatter,jobs,notes,selection,storage}, constants, types) were
      already single-word lowercase. Verified no PascalCase/camelCase filenames remain in src.
- [x] **13. Docs** — rewrote AGENTS.md "How the frontend is structured" + iOS Widget paths ✅

## Verification

- `npx tsc --noEmit` clean after every stage.
- Full `vite build` (main): 2081 modules transformed ✅
- OTA `vite build --config vite.ota.config.ts` (entry src/main.tsx): 2091 modules ✅
- (Pre-existing chunk-size warning is unrelated to this refactor.)

## Remaining housekeeping (for the user)

- This file (`REFACTOR_PROGRESS.md`) is temporary — delete when satisfied.
- The pre-existing uncommitted `README.md` edit was stashed at the start and restored
  to the working tree at the end (left uncommitted, untouched).
- `features/tree/keyboard-coordinates.ts` has no importers — candidate for deletion.

---

# Phase 2 — full feature-sliced + code-quality (in progress)

User feedback after Phase 1: dissolve `contexts/` and `data/` into features; add
in-feature **segments** so components/helpers/state are distinguishable; review and
improve the code itself (not just layout). Confirmed decisions:

- **Full feature-sliced**: no top-level `contexts/` or `data/`.
- **Segment names**: `components/` (.tsx), `hooks/` (hooks + context providers),
  `lib/` (pure helpers), `api/` (IPC). Optional `index.ts` barrel per feature.
- 9 features: notes, tree, editor, recording, handwriting, profiles, sync, security, settings.
- `app/state/`: cross-cutting stores with no single domain — `selection-context`,
  `theme-context`, `appearance-api`. (Pragmatic: features may import these from app/state.)
- `shared/`: `ui/` (shadcn), `lib/` (dom, format, frontmatter, jobs, notes, selection,
  storage, cn), `api/invoke`, `types.ts`, `constants.ts`, `hooks/use-mobile`.
- Domain note-headers move to their feature (recording/handwriting). Lens →
  `editor/components/lens/`. `desktop/` + `mobile/` stay as composition shells.

### Target

```
src/
  main.tsx ota-bootstrap.ts          entries
  app/        app, app-shell, main-app, error-boundary, launch-screen, app.css
    state/    selection-context, theme-context, appearance-api
  shared/     ui/  lib/  api/(invoke)  hooks/(use-mobile)  types.ts  constants.ts
  features/<name>/  components/  hooks/  lib/  api/  index.ts
    notes editor tree recording handwriting profiles sync security settings
  desktop/  mobile/   composition shells
```

### Stages (each: move/refactor → tsc clean → commit+push)

- [x] **P2.1 app/state** — selection-context, theme-context, appearance-api → app/state/
- [x] **P2.2 features/editor** — segments + decompose multi-note-lens (god component) into
      hook (use-lens-annotations) + lens sub-components + lib/lens-geometry
- [x] **P2.3 features/tree** — segments
- [x] **P2.4 features/notes** — note-row, notes-tree-context, use-note-previews, notes-api
- [x] **P2.5 features/recording** — recordings-context, use-audio-recorder, recordings-api, recording-note-header
- [x] **P2.6 features/handwriting** — handwriting-context, handwriting-api, handwriting-note-header
- [x] **P2.7 features/profiles** — profiles-context, profiles-api
- [ ] **P2.8 features/sync** — git-sync-context, git-api, local-sync-link, local-sync-server-card
- [ ] **P2.9 features/security** — security-context, security-api, lock-screen
- [ ] **P2.10 features/settings** — components/{desktop,mobile}, hooks/use-settings-data, lib/sections
- [ ] **P2.11 shared/** — ui, lib, api/invoke, types, constants, hooks/use-mobile (global @/ prefix sed)
- [ ] **P2.12 index.ts barrels** — public API per feature; route shell/cross-feature imports through them
- [ ] **P2.13 code-quality pass** — audit remaining large files (app-shell, use-keyboard-navigation, …); fix smells
- [ ] **P2.14 docs** — rewrite AGENTS.md + README; finalize this file

## Notes / surprises log

- `main.tsx` is the **OTA bundle entry** (`vite.ota.config.ts`), not dead code.
- `@/` alias present in all three configs — adopting it for cross-dir imports.
- `noUnusedLocals` is on — moves must also drop now-unused imports.
- Settings desktop (8 sections, incl. Transcription) and mobile (7 sections) are
  genuinely different UIs, not pure dupes — kept as two variants under one feature.
- `features/tree/keyboard-coordinates.ts` (was `tree/keyboardCoordinates.ts`) has
  **no importers** — appears to be dead (DnD context uses only PointerSensor).
  Moved as-is; candidate for deletion (flag to user, out of refactor scope).
