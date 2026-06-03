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
- [ ] **7. desktop/** — kebab-rename shells + move app-sidebar
- [ ] **8. mobile/** — ui/ + screens/ + views/ + hooks/, flatten components/, move use-edge-swipe
- [ ] **9. app/** — App/AppShell/mainApp/ErrorBoundary/launchScreen + update entry stubs
- [ ] **10. contexts/** — kebab-rename
- [ ] **11. data/** — kebab-rename
- [ ] **12. utils/ + constants/types** — final kebab pass
- [ ] **13. Docs** — rewrite AGENTS.md frontend section; delete this file; restore stashed README

## Notes / surprises log

- `main.tsx` is the **OTA bundle entry** (`vite.ota.config.ts`), not dead code.
- `@/` alias present in all three configs — adopting it for cross-dir imports.
- `noUnusedLocals` is on — moves must also drop now-unused imports.
- Settings desktop (8 sections, incl. Transcription) and mobile (7 sections) are
  genuinely different UIs, not pure dupes — kept as two variants under one feature.
- `features/tree/keyboard-coordinates.ts` (was `tree/keyboardCoordinates.ts`) has
  **no importers** — appears to be dead (DnD context uses only PointerSensor).
  Moved as-is; candidate for deletion (flag to user, out of refactor scope).
