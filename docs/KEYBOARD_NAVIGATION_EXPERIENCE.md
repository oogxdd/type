# Keyboard-First Feed and Folder Navigation

## Purpose

This document describes a reusable navigation experience for applications that
help a person process a large stream of unorganized items and gradually turn it
into an organized library.

The current notes app is one example. A bookmark reviewer is another:

- newly saved bookmarks arrive in a chronological Feed;
- the Feed groups them into useful date ranges without physically moving them;
- the user reviews the stream with the keyboard;
- some items are deleted, archived, or marked reviewed;
- valuable items are moved into ordinary folders;
- the content/details pane is always one shortcut away.

This is a product and interaction specification. It is intentionally not tied
to React, Tauri, notes, bookmarks, or a particular storage model. It can be
given to an implementation agent as the description of the desired feel.

## The experience in one sentence

The application should feel like a small keyboard-driven file manager joined
to a reader/editor: the left side answers **where am I and what is next?**, the
right side answers **what is this item?**, and switching between them never
requires the mouse.

## Core mental model

There are two navigation views over the same collection:

1. **Feed** is a generated, chronological projection of incoming items.
2. **Folders** is the durable organization created by the user.

These views are peers. Feed is not a real user folder and date groups are not
real folders. They only look and behave like folders so the same tree navigation
can be used everywhere.

```text
Navigation pane                         Content pane
┌────────────────────────────┐          ┌──────────────────────────────┐
│ [ Feed ] [ Folders ]       │          │                              │
│                            │  Enter   │  Bookmark, note, document,   │
│ ▾ Today                    │ ───────▶ │  preview, or editor          │
│   > Example item           │          │                              │
│ ▸ Yesterday                │ ◀─────── │                              │
│ ▸ This week                │  Cmd+W   │                              │
└────────────────────────────┘          └──────────────────────────────┘
```

In a three-pane variation, the application may have:

```text
Feed/Folder tree  →  items in selected group  →  reader/editor
```

The keyboard model should still expose only two conceptual destinations:
**navigation** and **content**. An extra list pane is an implementation/layout
detail, not a place where keyboard focus should become lost.

## Feed: chronological organization without filing

The Feed is for capture and review. Items should not become difficult to find
merely because the user has not organized them yet.

Build a synthetic date tree from item timestamps. A useful default hierarchy is:

```text
Today
Yesterday
This week
Last week
August
  Week 32 · Aug 3–9
    Monday 3
    Tuesday 4
2025
  Q4
    December
      Week 50 · Dec 8–14
Undated
```

Important rules:

- An item appears in exactly one chronological bucket.
- Buckets are newest-first at every level.
- Empty buckets are not rendered.
- Weeks are stable calendar weeks, preferably ISO weeks (Monday–Sunday).
- A week that crosses a month boundary must not be split into two fake weeks.
- Relative groups such as Today and This week must not overlap older calendar
  groups.
- `Undated` is an explicit fallback rather than silently losing items.
- Bucket counts and empty states are computed after filtering.

The chronological hierarchy is a projection. Moving, renaming, or deleting a
date bucket must never be offered because it is not a real container.

### Feed filters

The Feed should support lightweight flags that match the review workflow. The
current baseline is:

- **All** — every incoming item;
- **Active** — items not archived;
- **Reviewed** — items explicitly marked reviewed;
- **Unreviewed** — items not yet marked reviewed;
- **Archived** — items hidden from the normal active stream.

Flags are independent dimensions. For example, an archived item may also be
reviewed. Products may add domain-specific filters, but should avoid turning
the Feed into a complex query builder.

## Folders: durable user organization

Folders represent intentional, persistent organization. Unlike Feed buckets,
users may create, rename, move, nest, and delete them.

The Folders view should show only meaningful user folders. Synthetic navigation
labels and internal storage roots are not destinations. Examples that should be
excluded from folder pickers include:

- Feed;
- Archive/Trash when those are system-managed;
- a synthetic root named Folders;
- attachment, recording, cache, or other storage directories;
- legacy system directory names.

The distinction is simple:

```text
Feed/date group = a way to look at an item
User folder     = a place the user deliberately put an item
```

Moving an item into a user folder does not have to remove it from every
chronological view. That is a product policy. For an inbox-style reviewer, a
good default is to consider a successfully filed item processed and remove it
from the Active Feed while retaining its timestamp and history.

## Focus model

Keyboard behavior depends on **focus ownership**, not on whatever happens to be
selected in application state.

There are two focus zones:

- **Navigation focus** — Feed or Folders owns the navigation keys.
- **Content focus** — the reader/editor owns text entry, scrolling, and content
  commands.

Focus should always be visible as a focused or selected row. Do not draw the
focus indicator around an entire pane, an empty region between the tabs and a
settings button, or other container chrome. A container may technically receive
DOM/native focus for event handling, but the visual focus must identify the
current row.

Keep one remembered navigation row per view when practical. Switching from Feed
to Folders and back should return the user to the previous position instead of
jumping unpredictably to the first row.

## Keyboard contract

Shortcuts are scoped. Vim keys apply only while navigation owns focus and must
not steal input from text fields, selectors, dialogs, or editable content.
Letter shortcuts are bound to physical key positions rather than the character
produced by the active layout. For example, the `J` position navigates down
whether the OS layout produces `j` (English) or `о` (Russian); the same rule
applies to modal editor keys and modified shortcuts such as `Cmd+W` and
`Cmd+K`.

| Key | Navigation behavior |
|---|---|
| `j` or Down Arrow | Focus/select the next visible row |
| `k` or Up Arrow | Focus/select the previous visible row |
| `l` or Right Arrow | Expand the focused group/folder; if already expanded, enter its first visible child |
| `h` or Left Arrow | Collapse the focused group/folder; from an item, act on or return to its containing group/folder |
| `Enter` on an item | Open it and move focus to the content pane |
| `Enter` on a group/folder | Toggle expanded/collapsed state without leaving navigation |
| `Tab` | Switch between Feed and Folders while keeping navigation focus |
| `Cmd+W` / `Ctrl+W` | Toggle focus between navigation and content |
| `Cmd+K` / `Ctrl+K` | Open the command palette |

Navigation is over **visible rows**, not the entire hidden tree. Collapsed
descendants must be skipped. Movement clamps at the first and last row rather
than wrapping unless a product explicitly chooses wrapping.

### `h` and `l` when an item is focused

An item is a leaf, but `h/l` should remain useful:

- `h` targets its containing group/folder, collapses that parent, and leaves a
  visible focus target;
- `l` targets its containing group/folder and expands it;
- in a Feed, the containing target is the synthetic date group;
- in Folders, it is the item's real parent folder.

### Pane toggle

`Cmd+W` is a toggle, not a cycle through every technical pane:

```text
navigation focus  --Cmd+W-->  content focus
content focus     --Cmd+W-->  last navigation focus
```

If navigation is hidden/collapsed, invoking the shortcut from content should
reveal it and focus its last meaningful row.

On the web, browsers normally reserve `Cmd+W` for closing a tab and may not let
an application safely override it. Keep the semantic command named **Toggle
navigation/content focus**, make its binding configurable, and use `Cmd+W` only
in a native shell or another environment where interception is reliable.

## Modal navigation inside editable content

For products whose content pane contains substantial text, the editor may use
the same Vim-style modal model instead of becoming a keyboard-navigation dead
end:

- entering or returning focus to the editor starts in **Normal** mode;
- `i` enters **Insert** mode at the cursor and `a` enters after the cursor;
- `Escape` returns to Normal mode;
- `v` enters or leaves **Visual** selection mode;
- `h/j/k/l` move in Normal and extend the selection in Visual;
- `Ctrl+j` / `Ctrl+k` make larger vertical jumps;
- printable input, paste, and destructive editing are blocked outside Insert;
- Normal uses a filled, character-sized terminal block that inverts the glyph,
  Visual uses a filled blue block plus blue selection, and Insert uses a
  blinking vertical caret;
- opening a different item places the Normal-mode cursor on its first text
  symbol and scrolls to the beginning; refocusing the same item preserves the
  user's position;
- an optional mode label can reinforce the cursor, but should be hidden by
  default and exposed as an appearance setting;
- pane-level shortcuts such as `Cmd+W` continue to work in every editor mode.

Modal keys must be handled before global pane shortcuts. In particular,
`Ctrl+j/k` inside the focused editor belongs to the editor, while the same keys
outside it may retain an application-level meaning.

## Review workflow

The common loop should be fast enough to repeat hundreds of times:

```text
Open Feed
  ↓
Choose a date group with j/k and h/l
  ↓
Open an item with Enter
  ↓
Read or inspect it
  ↓
Delete, archive, mark reviewed, or move to a folder
  ↓
Return to navigation and continue near the previous row
```

Actions should have predictable consequences:

- **Delete** removes an item, preferably with an undo window or recoverable Trash.
- **Archive** removes it from Active without destroying it.
- **Reviewed** records that it was inspected but does not imply deletion.
- **Move/File** assigns durable organization.
- After an action removes the current item, focus should move to the nearest
  surviving row, normally the next item and otherwise the previous item.
- The user should never be stranded on an invisible or deleted selection.

## Command palette and move mode

The command palette is both a discoverable command surface and a fast filing
tool. A terminal-like `mv ` mode works well:

```text
Cmd+K
mv pro
Projects
```

Move-mode rules:

- show only user-created destination folders;
- hide Feed, date buckets, Folders, Archive/Trash, and internal storage roots;
- fuzzy-search all user folders by name when typing a simple query;
- support path drilling for nested folders;
- Right Arrow or Tab drills into the highlighted folder and shows its children;
- Enter moves the active/selected item directly into the highlighted folder;
- clearly distinguish “move to existing folder” from “create folder and move”;
- preserve multi-selection when moving several items together;
- close the palette after a successful move and show failure without losing the
  user's intended destination.

System destinations must be rejected in the action layer as well as hidden in
the UI. Filtering only the displayed suggestions is not enough.

## Mouse and accessibility behavior

Keyboard-first does not mean keyboard-only.

- Clicking a row selects it and establishes navigation focus.
- Clicking an item may open it, following the product's single/double-click
  convention.
- Expand/collapse controls remain individually clickable.
- Context menus expose the same important actions as the command palette.
- Native arrow-key and screen-reader semantics should be preserved where
  possible.
- Do not run Vim shortcuts when an `input`, `textarea`, `select`, dialog input,
  or `contenteditable` element owns focus.
- Visible focus must have sufficient contrast in both light and dark themes.
- Do not remove every focus outline without replacing it with a row-level focus
  indicator.

## State the implementation should model explicitly

Avoid inferring all of this from the DOM. Model at least:

- active navigation view: Feed or Folders;
- focus zone: navigation or content;
- focused/selected row in each navigation view;
- expanded group/folder IDs;
- active item;
- multi-selected item IDs, if supported;
- active Feed filter;
- visible flattened rows derived from the current tree, expansion, and filter;
- real versus synthetic/system folders;
- last meaningful navigation focus for pane restoration.

The same navigation reducer/function should ideally operate on Feed groups and
real folders through a shared row shape:

```ts
type NavigationRow =
  | { type: "group" | "folder"; id: string; parentId: string | null }
  | { type: "item"; id: string; parentId: string };
```

This keeps `j/k/h/l/Enter` consistent even though Feed and Folders come from
different data models.

## Acceptance criteria for an implementation agent

An implementation is complete when all of these are true:

1. A user can open the app, enter Feed, review several items, file one into a
   nested folder, and return to the next item without touching the mouse.
2. Feed grouping is deterministic, newest-first, non-overlapping, and contains
   every item exactly once.
3. Feed filters update groups, counts, selection fallback, and empty states.
4. `j/k` traverses only visible rows in both Feed and Folders.
5. `h/l` operates on groups/folders and on the parent of a focused item.
6. Enter opens an item into content or toggles a group/folder.
7. Tab switches Feed/Folders only while navigation owns focus.
8. The pane-focus shortcut toggles navigation/content and restores meaningful
   navigation focus.
9. No whole-pane or empty chrome region appears to be the focused item.
10. Text entry and native controls do not trigger Vim navigation.
11. Move suggestions never contain synthetic, system, or storage folders.
12. Right Arrow/Tab drills into move destinations; Enter performs the move.
13. Removing or filtering the active item chooses a nearby surviving row.
14. Mouse, context-menu, and screen-reader interaction still work.

## Suggested tests

At minimum, add pure tests for:

- flattening expanded trees into visible rows;
- `j/k` bounds and collapsed-descendant skipping;
- `h/l` behavior for folders, groups, and child items;
- Feed boundary dates, cross-month ISO weeks, undated items, and no duplicates;
- each Feed filter and its empty state;
- exclusion of every system-folder alias from move destinations;
- move-mode fuzzy search and nested-folder drilling;
- focus fallback after delete, move, archive, or filter changes.

Add integration tests for pane focus, input guards, Enter behavior, and the full
review-and-file workflow.

## Short handoff prompt

The following can be pasted above this document when assigning a new project:

> Build the application's navigation according to
> `KEYBOARD_NAVIGATION_EXPERIENCE.md`. Treat Feed as a chronological synthetic
> tree and Folders as durable user organization. Preserve the exact focus and
> Vim keyboard semantics, adapt item-specific actions to this product, and test
> the complete keyboard-only review-and-file workflow. Do not expose synthetic
> or internal folders as move destinations. If the platform reserves one of the
> specified shortcuts, preserve the semantic command and propose the closest
> configurable binding before changing the interaction model.
