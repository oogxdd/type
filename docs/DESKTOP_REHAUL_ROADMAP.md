# Desktop frontend rehaul — remaining roadmap

Status snapshot and forward plan for the `desktop-state-rehaul` line of work.
Paths below are inside `apps/desktop/src/` unless noted. This is an engineering
roadmap, not a lesson — the pedagogical architecture book lives in
`docs/architecture/` (Russian) and describes the Rust layers, which are
unaffected.

## Where we are

The structural rehaul is landed:

- **No React context providers.** Every domain (appearance, selection,
  profiles, security, editor, notes tree, previews, recordings, handwriting,
  git sync) is a module-level zustand store. `providers.tsx`, `FlushSaveBridge`,
  `flushSaveRef`, `CaptureFeatureProviders`, and the untyped `CustomEvent` bus
  are gone. Invalidation is two greppable calls: `refreshTree()` and
  `invalidateNotePreviews()`.
- **Kind-based layout.** `components/` (nested by domain) · `state/` · `hooks/` ·
  `lib/` (with `lib/notes/` and `lib/lens/` pure models) · `api/` · `app/`
  (composition root). No `index.ts` barrels; `@/` → `src/`.
- **Cross-domain reactions are store subscriptions** wired once in
  `app/bootstrap.ts` before React renders (subscription order matters — see
  AGENTS.md).
- **Profiles are folders.** The settings section keeps the name "Profiles"; a
  profile is just a directory you pick (or create empty) in the picker. No
  backend change.
- **Selection-store idiom finished** (commit `cd1ca1c`): `selectFolder`,
  `selectNote`, `resetSelection`, and the setters are exported module functions
  like every other domain. The ten-field `useShallow` destructure at the top of
  every interaction hook is gone; consumers subscribe only to values they render.

The state layer now cleanly separates two concerns:

- **State** → zustand stores (raw data + plain-function actions).
- **Derivation** → `memoizeOne`-wrapped pure functions in `lib/notes/` and
  `lib/lens/`, shared by React selectors and non-React callers.

## The one axis the rehaul did not finish: orchestration vs. React

The remaining complexity did not disappear — it **moved from the mega-context
into `hooks/`**. Interaction/orchestration logic still lives in large
`useCallback`-heavy hooks:

| Hook | Lines |
|------|------:|
| `use-lens-annotations.ts` | 616 |
| `use-drag-drop.ts` | 492 |
| `use-command-palette-commands.ts` | 387 |
| `use-navigation-tabs.ts` | 273 |
| `use-keyboard-navigation.ts` | 239 |
| `use-tree-interactions.ts` | 225 |
| `use-pane-shortcuts.ts` | 217 |

Now that **actions are module functions** and **selectors are cheap**, much of
what these hooks do is ceremony: bind a store selector, wrap a plain call in a
`useCallback` with a dependency array, hand it to a component. The
selection-store migration is the template for undoing that: the *decision* logic
becomes a pure function in `lib/` (many already are — `lib/notes/*-model.ts`),
the *effect* is a store action, and the hook shrinks to selector-binding + JSX
wiring. Tasks 3–5 below are all instances of this same move; keep it as the
through-line.

## Roadmap (priority order)

### 0. Merge gate — run on a real machine + code-review

Everything is verified by typecheck, `vite build`, and the test suites, but the
CI VM cannot launch Tauri (missing GUI libs). Before merge, on a Mac: boot,
switch profiles, record a note, drag-drop a folder and a note, and do one
lock/unlock cycle with the security extension flag on. That exercises every
subscription rewired by hand. A `/code-review` on the branch is worth it — it is
a large diff.

### 1. Tests for the state layer — highest value, now cheap

Stores and actions are plain modules, so they test with a mocked `api/` and no
React. Lock in the invariants that were ported by hand:

- empty-note delete on leave;
- auto-rename on flush (content slug);
- previews never persist under encryption (`clearPersistedNotePreviews`);
- profile-switch ordering: editor clears before the selection reset can flush
  stale content into the new root.

One suite each for `editor-store`, `notes-actions`, `note-previews`. Do this
first so the DnD simplification (step 5) has a safety net.

### 2. Selection-store idiom — ✅ done (`cd1ca1c`)

### 3. Delete dead `components/ui/` + collapse the sidebar

Pure deletion, zero behavior change:

- **11 primitives with no importer anywhere:** `breadcrumb` (109),
  `card` (92), `field` (246), `label` (22), `native-select` (53),
  `popover` (89), `separator` (28), `sheet` (143), `skeleton` (13),
  `sonner` (35), `tooltip` (55) — ~885 lines.
- **`ui/sidebar.tsx` is 637 lines** and has exactly one consumer,
  `shell/app-sidebar.tsx` (111 lines), which renders what is effectively a fixed
  icon rail. Replace the generic shadcn sidebar machinery with ~40 lines of
  flexbox in `app-sidebar.tsx` and drop `ui/sidebar.tsx` (and `use-mobile.ts`,
  which exists to feed it).

Net ≈ −1.5k lines. Lens and security stay untouched.

### 4. One command registry

The command surface is encoded **three times**:

- `use-command-palette-commands.ts` (387) builds the palette;
- `use-pane-shortcuts.ts` (217) hardcodes the keymap;
- `shell/context-menu.tsx` (291) wires its own actions.

A single registry — `{ id, label, shortcut, run, when }` — consumed by all three
collapses the remaining keyboard paths and makes shortcuts discoverable in the
palette for free. This is a separation-of-concerns fix: "what commands exist" is
currently scattered across three UI surfaces instead of owned in one place.

### 5. De-optimistic the drag-and-drop — full plan below

### 6. (Later, when mobile work resumes) Feed model → `packages/shared`

`lib/notes/feed-tree-model.ts` is **711 lines — the single largest file in the
desktop app** — and the same bucketing logic is written a second time in
`apps/mobile/src/lib/feed.ts`. There is no shared version. This is the
highest-*structural*-risk item in the tree: two hand-maintained copies of the
same time-bucketing rules are a drift bug waiting to happen. Extract the pure
model into `@typenotes/shared` (it is already pure and tested) and have both
apps import it. Deferred only because it is cross-app and wants mobile in the
loop.

---

## Task 5 in detail: de-optimistic drag-and-drop

### The problem

`hooks/use-drag-drop.ts` (492 lines) and roughly half of `lib/notes/tree-ops.ts`
(318 lines) exist to maintain a **local mirror of the backend tree** so a drop
mutates the UI before the filesystem move returns. The folder-drop path
(`handleFolderDragEnd`, ~145 lines) does this by:

1. pruning the dragged subtrees out of the local tree (`removeNodes`) and
   splicing them back at the resolved target (`insertNodes`) to build `nextTree`;
2. flattening old and new trees into `parentById` maps and diffing them to
   decide which folders need a filesystem `moveItems`;
3. building per-parent order maps for both trees (`buildFolderOrderMap`),
   diffing them (`arraysEqual`) to decide which parents need `setOrder`;
4. applying the new order back onto the live tree (`applyFolderOrder` +
   `setTree`) so a pure reorder skips the refetch;
5. calling `refreshTree()` only when a parent actually changed.

The caching doc (`docs/architecture/07-frontend-caching.md`) already notes IPC is
millisecond-fast. A "drop → backend move → `refreshTree()`" round-trip is
visually indistinguishable from the optimistic rebuild, and the
**note**-drop path (`handleNoteDragEnd`) already works exactly this simple way:
resolve the target, compute one parent's new order with `reorderList`, persist,
`refreshTree()`.

### The plan

Make the folder path mirror the note path. Keep the whole **gesture layer** —
this is interaction quality, not an optimization, and must not be touched:

- `handleDragMove` edge-zone detection, spring-load auto-expand, `edgeSnap`;
- `parseDropTargetId`, `findParentAndIndex` (resolve target parent + insertion
  index), `sortIdsByTreeOrder`, `getTopLevelSelected`, `isInDraggedSubtree`,
  `getNodeById`, `isSystemFolder` guards.

Then, on drop, instead of rebuilding the tree:

1. Resolve `(targetParentId, targetIndex)` from the gesture (already computed).
2. For each dragged id whose parent changes, `await moveItems([id], targetParent)`.
3. Compute the target parent's new child order with `reorderList` (the same
   helper the note path uses) and `setOrder` it — one parent, not a full-tree diff.
4. `await refreshTree()` unconditionally.

### What gets deleted

From `tree-ops.ts`, these become unused (confirmed: only importer is
`use-drag-drop.ts`):

- `removeNodes`, `insertNodes` — the local prune/splice (~64 lines);
- `buildFolderOrderMap`, `applyFolderOrder`, `arraysEqual`, `buildNoteOrderMap`
  — the order-diff machinery (~65 lines);
- plus their cases in `tree-ops.test.ts`.

Keep (still used by the gesture layer or the note path): `flattenTree` (shared
with `notes-store` / `dnd-tree`), `reorderList`, `findParentAndIndex`,
`sortIdsByTreeOrder`, `getTopLevelSelected`, `isInDraggedSubtree`,
`parseDropTargetId`, `getNodeById`, `findNode`.

### Payoff and risk

Roughly **−250 to −350 lines** across `use-drag-drop.ts` + `tree-ops.ts` +
their tests, and the trickiest code in the app (a second, hand-maintained copy
of backend tree state) is gone. **Do this after step 1** so the state-layer
tests catch any regression in move/reorder semantics — this is the one step here
that changes runtime behavior rather than just moving code.

## One-line framing

The rehaul separated **state** from **derivation**. The remaining work
(3–5) separates **orchestration** from **React**, and one item (6) separates
**shared logic** from **per-platform copies**. Everything below step 2 is either
pure deletion or a mechanical application of the idiom already proven in the
selection-store migration.
