# Stream day cutoffs

A day often ends after midnight: notes written at 02:00–04:00 belong to the
evening before, and the morning should open on a fresh Today. The user moves
them manually; nothing is inferred from sleep gaps or a fixed hour.

## Behaviour (desktop, 2026-10-18)

- Cmd+K or the note context menu: **Move to previous day** on a note ends the
  previous day at that note. It and every earlier note of its calendar date
  are grouped under the day before. With several notes selected, the latest
  one is the boundary.
- **Move back to its day** (shown only for a moved note) returns that note and
  every later one to its calendar date; earlier notes stay moved. When nothing
  earlier remains moved, the cutoff is removed.
- Note files are never written: `created`/`updated` and the filename stay as
  they are. Only grouping changes (Stream days/weeks, Trash months, “review a
  day”). The moved note stays selected and its new day group expands.

## Storage

Synced `<notes root>/.type/day-cutoffs.json`, other keys preserved:

```json
{ "version": 1, "cutoffs_ms": [1792371120000] }
```

Each entry is an absolute instant (epoch ms). A note instant `t`
(`created_ms`, else `updated_ms`) has effective day:

```
d = local_date(t)
d - 1  if some cutoff c has local_date(c) == d and t <= c
d      otherwise
```

Local dates are resolved when reading, so the file has no timezone or
date-string keys. There is at most one cutoff per local date; setting a new one
replaces the old. Merge conflicts can be resolved by taking the union of both
lists: when two cutoffs share a date, the later one wins.

Code: core `load_day_cutoffs` / `save_day_cutoffs`
(`crates/type-core/src/adapters/notes/day_cutoffs.rs`); date logic in
`apps/gpui/src/navigation.rs` (`effective_day`, `cutoffs_ending_day_at`,
`cutoffs_starting_day_at`); command in `workspace.rs` `shift_day`.

## Rejected options

- **Per-note frontmatter (`day: 2026-10-17`)**: writes N files for one action,
  produces Git diffs and draft/sync conflicts, and does not keep moves
  contiguous (a 02:00 note could stay in today while 03:00 moves). It also
  needs frontmatter for grouping, which the user wants to drop in favour of
  filename-derived dates.
- **Renaming files or changing `created`**: falsifies creation time.
- **Automatic day start (e.g. 05:00) or sleep-gap detection**: explicitly not
  wanted. A configurable default could later be added on top of the cutoffs.
- **Cutoffs in `_system/stream/`**: Stream has no metadata files by
  invariant; `.type/` is already the synced home for settings and pins.

## Not done

- Mobile Stream (`apps/mobile` note worklets) and MCP do not read cutoffs yet;
  they group by calendar date until the same rule is mirrored there.
- The rule can only move notes one day back, with no cascading. That is enough
  for the late-night case.
