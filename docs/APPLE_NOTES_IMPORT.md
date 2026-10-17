# Repeating an Apple Notes import

Read this before importing an Exporter folder into an existing Type profile.
This is an operational procedure for an authorized import of the user's data;
it is separate from personal analysis/reviews and application development.

## Find the previous import

Use the notes root confirmed by the user. Do not infer the destination from the
active development profile. Look inside that root for:

- `.type/apple-notes-last-import.json`: latest creation timestamp, source export,
  manifest path, counts and identity of the last newly imported note.
- `_system/agent/imports/apple-notes-YYYY-MM-DD-manifest.jsonl`: per-source-file
  reconciliation, including duplicates matched to existing notes.
- `_system/agent/imports/apple-notes-YYYY-MM-DD-progress.md`: journal, checks and
  limitations. A dated `-checkpoint.json` preserves the checkpoint for that run.

If these are absent, search the notes repository's Git history and older import
journals. The import date and the creation date of the newest imported note are
different. Do not turn an approximate user recollection into a strict cutoff.

Keep personal import history, counts, paths and actual boundary timestamps in
the target notes root, not this repository. Always read the current checkpoint
and its journal. A fresh export may contain additional notes dated on or before
the previous boundary, as well as changed old notes.

## Validate the export and prepare a plan

Exporter Markdown with its folder hierarchy and adjacent image directories is
suitable. Validate UTF-8, count files, inspect attachment references and determine
which metadata actually preserves original creation/modification dates. The
built-in importer in `crates/type-core/src/adapters/import.rs` supports Markdown,
HTML and text, but currently creates new notes on every run and skips attachment
files. It does not perform this incremental reconciliation. There is currently
no maintained incremental Apple Notes CLI in this repository; do not substitute
the built-in import action for the procedure below.

Reconcile the **entire export**, even when a checkpoint timestamp is available:

1. Compare source-relative paths and SHA-256 hashes with the latest manifest.
   Unchanged sources are already accounted for. Raw hashes also identify known
   content exported under a different path.
2. Resolve existing Type targets before proceeding. Notes may have moved since
   the last manifest. Prefer UUID/content identity; a unique unchanged basename
   can locate a candidate, whose identity should then be verified. Update the
   mapping instead of reimporting moved notes. A missing target may represent an
   intentional deletion; do not silently restore it.
3. Compare remaining sources with existing note bodies and other candidates.
   Ignore Type frontmatter and known Exporter formatting when appropriate.
   The earlier imports normalized whitespace and empty `#` headings. Be careful
   with whitespace-sensitive Markdown/code and rewritten image links; record
   the normalization policy rather than assuming raw hashes are comparable.
4. Preserve changed old exports as separate revisions linked to their previous
   targets in the manifest. Do not overwrite notes edited in Type. If the user
   explicitly requests merging/replacement, compare the current destination
   hash against the previous imported hash first and preserve unknown metadata.
5. Stage the proposed notes, attachments and receipts outside the destination;
   report counts and validate them before writing. Keep the source export intact.

Respect profile encryption and local privacy instructions. A filesystem import
must not bypass enabled body encryption or write plaintext staging/recovery files
for an encrypted profile. Private notes can be transferred without quoting or
analyzing their contents; do not emit their titles or bodies in tool reports.
Do not open another app instance against the same root or restart the user's app.

## Write notes, attachments and the checkpoint

For the established flat import, new notes go into `_system/stream` with a unique
UUID, `created_ms`, `updated_ms` and `imported_from_apple_notes: true` frontmatter.
Stream has no `.notes-order.json`. Preserve the source body except for local link
rewrites required by attachment relocation. Check every destination for collisions
and create new files exclusively; never rely on rename overwriting safely.

Copy referenced local attachments into a run-specific directory under
`_system/_attachments/apple-notes-YYYY-MM-DD/`, deduplicate by content hash and
rewrite relative links from the imported note. Resolve URL-escaped paths, reject
links escaping the export and detect missing files. Local links between notes
need explicit target mapping; do not treat them as attachments or leave them
silently broken.

Use original creation metadata when available. Check whether file birthtime
dates agree with the `DD-MM-YYYY-` filename prefixes. When preserved, birthtime
can supply the time of day and modification time can supply `updated_ms`.
Store UTC ISO timestamps and epoch milliseconds. Label this provenance as
Exporter-preserved filesystem metadata, not independently verified Apple Notes
API metadata. If only a filename date survives, record day precision instead of
inventing an exact time. Copying/re-extracting an export can reset birthtimes.

Write a complete UTF-8 JSONL manifest, including skipped/matched sources. Read
JSONL by newline-delimited file iteration, not Python `str.splitlines()`:
filenames may contain Unicode line separators inside JSON strings. Record:

- `source`, `source_sha256`, `source_created_at`, `source_created_ms` and
  `source_updated_at` for each source;
- `status` and the current Type-relative `target` for each mapping;
- `id` and `imported_sha256` for new notes, plus `previous_target` for revisions.

The checkpoint's `created_at` and `created_ms` are the maximum creation timestamp
among newly imported notes, not the import execution time. Also record
`imported_at`, `timestamp_origin`, `manifest`, `source_export`, `last_imported_note`,
counts and attachment totals. On a no-op run, retain the previous creation
watermark. Keep both `.type/apple-notes-last-import.json` and a dated copy with
the journal. The timestamp helps narrow a search; the manifest remains necessary
for equal timestamps, edits and backdated additions.

## Commit and verify

When the user requests commits before and after, create the first commit in the
**notes repository** before writing import files, including the user's existing
changes as requested. Check that the working tree is clean before applying the
plan; account for possible app autosaves. Stage only the import's intended files
for the final commit so unrelated concurrent edits remain identifiable. Record
the pre-import commit in the journal and report both commit IDs afterward.

Verify source and written-file hashes, unique IDs for new notes, preserved
timestamps, all mapped targets and every imported local attachment link. Check
that existing files were not modified, the manifest covers the entire export,
the checkpoint points to an actual newly imported note and the final commit
contains exactly the intended files. Report any remaining working-tree changes.
These are transfer checks; never use personal notes as automated test fixtures.

An import does not constitute personal review. Leave review coverage and the
personality map unchanged. Record transfer details in the import journal so a
fresh agent can resume without conversation history. Do not push the notes
repository unless the user asks.
