# Personal observer through the notes MCP

Product model: [PERSONAL_AGENT.md](PERSONAL_AGENT.md). Implementation decisions
and verification: [PERSONAL_AGENT_IMPLEMENTATION.md](PERSONAL_AGENT_IMPLEMENTATION.md).

The server provides context and durable memory; the connected agent does all
reasoning and generation. No model, API key, UI or background schedule is added.
You can talk to your agent and inspect the resulting Markdown in the filesystem.

## Build and connect

From this checkout (Node >=22.13, dependencies installed):

```sh
npm run mcp:build
npm run mcp:test
node scripts/test-notes-mcp.mjs
```

Add the following MCP entry to your client config, replacing the two absolute
paths. For Codex, this is `~/.codex/config.toml` or a trusted project's
`.codex/config.toml`. If a notes server is already configured, update that entry
instead of connecting two copies to the same profile.

```toml
[mcp_servers.type_notes]
command = "node"
args = ["/ABSOLUTE/TYPE/CHECKOUT/apps/notes-mcp/dist/main.mjs", "--notes-root", "/ABSOLUTE/NOTES/ROOT", "--layout", "auto"]
enabled_tools = ["prepare_context", "list_notes", "read_note", "read_document", "search_notes", "list_changes", "create_reference", "resolve_reference", "check_dependencies", "list_memory_folder", "read_memory", "write_memory", "move_memory", "delete_memory", "save_artifact"]
tool_timeout_sec = 120
```

`--notes-root` is the parent containing Feed/me/agent or `_system`, **not Feed or
stream itself**. `auto` selects the existing layout without moving anything.
If both layouts exist, startup refuses ambiguity; use `--layout legacy` while
working with the old profile, or `system` once the migration is complete. Empty
roots use system layout. Merely starting the MCP does not create memory folders.
Do not migrate a profile just to try this server.

Restart/reconnect the client; in Codex `/mcp` shows the active tools. These config
fields are described in the [official MCP documentation](https://developers.openai.com/codex/mcp)
(checked 2026-09-20). The allowlist keeps generic destructive filesystem tools
out of this observer workflow. Other client filesystem tools are a separate
access path; the MCP filter cannot restrict those.

## What to say

Start simply:

> Use the Type notes MCP. Start with prepare_context(mode="review"). Read my
> overview and corrections, then review new notes in context. Save useful
> analysis and update me only where justified. Keep your reply short.

Other modes:

- `morning_note`: one paragraph to help enter the person's day.
- `observation`: one grounded observation; no manufactured insight.
- `conversation`: free personal dialogue with substantive initiative, useful broader knowledge, grounded patterns and help clarifying or organizing life. No single predefined goal or mandatory interview.

The person need not title or classify their thoughts. One note can contain many
topics; daily review boundaries can cross midnight. Writing more and analyzing
more are not goals in themselves. Respect requests not to save and do not turn
every session into more homework.

## Agent workflow

1. `prepare_context` explicitly returns full filtered `agent/START.md`,
   `agent/AGENTS.md`, `agent/README.md` and `agent/session-learning.md` in
   `instructionDocuments`, independently of preview ranking and pagination.
   Each entry includes its area/path and a document: null means missing;
   unavailable means it could not be safely read. Read all available instructions
   before proceeding; current user clarifications take precedence over old memory.
   With no summarySize it returns the complete available legacy `me/overview.md`.
   Set `summarySize:"short"`, `"medium"` or `"large"` to select the complete
   `me/summaries/<size>.md` instead. `summary.document:null` means missing;
   `{unavailable:true}` means unreadable/hidden/empty. No other summary is
   silently substituted. `me/README.md` is returned as `mapIndex`. Corrections,
   optional preferences and session handoff, recent source previews, review
   previews and working-memory references are also returned. Read sources with
   `read_note` or `read_document`. Profile context is never silently shortened.
   Recent previews are navigation, not an exhaustive reviewed period. Continue
   `prepare_context` with its cursor for recent stream pages; use `list_notes`
   scope/date filters for exhaustive selection. A changing corpus can reorder
   recent pages, so use `list_changes` for reproducible delta pagination.
2. `list_changes({since?})` compares primary stream records with an earlier
   snapshot. Follow `nextCursor` using the original `since` and returned
   `snapshot` on every continuation. Source changes during pagination fail with
   a restart request. Snapshots contain opaque IDs/revisions and persist in
   `agent/observer-state`. They are **inventories**, not claims of completed review.
3. Read relevant notes and older reviews. `metadata.kind` distinguishes primary,
   derived, review, profile, working, instructions and structure. Existing reviews
   in Feed are still reviews. `scope:"stream"` selects the area, not only primary
   notes. `structure` is excluded from prepared observer context. `list_notes`
   and `search_notes` accept kind and reviewType filters. Date filters on reviews
   select periods overlapping the requested inclusive dates, rather than their
   file creation dates. Use kind:"review" across all scopes to include old reviews.
4. `save_artifact` records an analysis/review/observation/morning_note with exactly
   the source IDs and revisions actually used. Reviews require reviewType and
   explicit periodStart/periodEnd (dates or ISO times with offsets). Types are
   day/week/month/quarter/year/period. Supply coverageStart/coverageEnd together
   for the actual covered interval; mark uncertain, unfinished or gapped periods
   partial (the default). partial:false declares the full period covered; omitted
   coverage bounds then equal the period. This is the agent's declaration, not
   evidence that the server analyzed all days. Reuse a stable key, e.g.
   `week:2026-09-14`. New reviews go to reviews; other artifacts go to agent.
   An identical retry returns the existing artifact, even after a scoped move.
   Changed content requires expectedRevision from read_memory using the returned
   area/path. Existing agent artifacts update in place; startup never migrates them.
5. `read_memory(area:"me",path:"overview.md",editable:true)` returns complete
   editable Markdown and revision. `write_memory` updates with that revision,
   or creates when it is absent. Every new memory document gets a UUID. Its
   separate `source` field contains the ID and revision for dependencies/citations;
   the top-level revision is exclusively for editing/moving/deleting the file.
   Source dependencies accept role:"evidence" (default) or role:"context".
   A direct conversation
   clarification may have an empty source list with the explanation in `reason`.
   Keep facts, dated self-reports and hypotheses distinct. Updating memory is not
   proof that the user's interpretation or the agent's conclusion is correct.
   `check_dependencies({id})` checks direct inputs and reports current/stale/unknown;
   follow derived inputs to check deeper ancestry. It never regenerates documents.
   Git is the main history. `retainHistory:true` on a write/save/delete additionally
   retains the old readable version; it defaults to false. The MCP does not commit;
   an external agent can make a local commit of its own changes using Git tooling.
6. Preserve useful unfinished work in agent via write_memory or save_artifact.
   Keep a brief `agent/session.md` recording the latest relevant snapshot ID,
   completed artifact paths, actual coverage and what remains. Do not advance a
   "fully reviewed" cursor merely because list_changes produced a snapshot.
   The next fresh agent receives this handoff from prepare_context.
7. During personal conversations, selectively retain useful clarifications and
   analyses without waiting for a separate save request; respect requests not to
   save. Update dated me information only where justified. Refine workflow
   instructions in agent when the person clarifies expectations, especially
   AGENTS.md/session-learning.md, which the next session explicitly receives.
   Do not create a log for every exchange. The connected agent performs this
   work during the session; the server does not analyze chats after they close.

Useful directories (relative to the resolved memory areas):

```text
me/README.md                 map navigation
me/summaries/short.md         also medium.md and large.md
me/overview.md                legacy context, still supported
me/<arbitrary tree>/*.md      evolving topics and meaningful dated changes
reviews/daily/<date>-<key-hash-prefix>.md
reviews/weekly/...            also monthly/quarterly/yearly/periods
agent/corrections.md
agent/preferences.md          optional user instructions for personal sessions
agent/session.md              concise continuation / actual coverage
agent/artifacts/<key-hash>.md  analyses and existing legacy reviews
agent/history/...             explicitly retained old memory/artifact versions
agent/memory-updates/...       rationale + sources, labeled as update intentions
agent/observer-state/...       source inventory snapshots
```

History and internal state do not enter ordinary note discovery. They remain
available through explicit memory reads/filesystem inspection. Original journal
notes are never writable through the observer API. A failed write can leave an
intent receipt or retained old version; neither claims the update succeeded.

`list_memory_folder({area,path?,cursor?,limit?})` browses visible documents in
me/agent/reviews and their ancestor folders. Empty folders and folders containing
only hidden/internal files do not appear. Create parents by writing a document.
`move_memory` moves a note or folder within one area without overwriting;
individual note moves require the edit revision. `delete_memory` removes one
fully readable document with its edit revision. Internal state/history paths are
reserved. Reviews are created/updated through save_artifact so period metadata
is preserved. Relative memory paths are an explicit capability; source filenames
are never returned by document reads.

## Structured reads and references

`read_note` retains plain permitted text and adds outline/links. `read_document`
accepts an ID and optionally a heading anchor or startLine/endLine; it returns
numbered permitted lines. Heading levels 1–6 are supported, including duplicate
titles with distinct anchors. A heading range includes its nested subsections.
Lines are 1-based, inclusive, in the filtered text for that revision; they are
not raw Markdown file positions. Hidden text does not create exposed gaps.

Use the returned anchors instead of guessing them. Navigation links target the
current document or heading. Heading anchors derive from visible titles, so
renaming/reordering repeated headings can require updating navigation links.
Citations pin the whole permitted revision and never silently follow different
words. Sources are not copied into an additional historical archive.

```text
read_document({id})
create_reference({id, kind:"citation", expectedRevision, startLine:3, endLine:5})
create_reference({id, kind:"navigation", heading:"место-жизни"})
resolve_reference({uri})
```

Store the returned URI as a normal Markdown link. The wire format is
`type-note://<id>?revision=<sha256>#L3-L5` for a citation and
`type-note://<id>#heading=<encoded-anchor>` for heading navigation. Whole-document
links omit the fragment; navigation omits the revision. Only validated type-note
link targets survive projection; external URLs and arbitrary attributes do not.

Resolution returns ok, changed, unavailable or target_unavailable. Changed
returns the current document identity/version, without pretending to recover the
old excerpt. Deletion and becoming private both produce unavailable. No MCP
resources/read handler or application click handler is installed in this phase.

## Source identity and privacy

Opaque IDs survive server restart and rename for a unique valid frontmatter UUID
within a semantic area, including copies on another device or root path. Stream
IDs also survive Feed→_system/stream migration. Moving across semantic areas
changes identity; move_memory deliberately stays within one area. Duplicate UUIDs
remain separate, with identityAmbiguous:true. Missing/duplicate UUIDs use local
path identity, report portable:false and cannot create portable references.
New document IDs are hashes of the UUID and area, without an absolute root.

Pre-upgrade root-scoped IDs remain readable as aliases in their original root.
Re-baseline delta snapshots once when upgrading: the ID/revision format has
changed, so an old snapshot can show added/unavailable records. Old alias links
need conversion using create_reference before copying a root to another device.
No raw source filename or original frontmatter is exposed by source reads.

Revisions for sources hash permitted text, structure, internal links and
allowlisted metadata. They identify
what the agent could read, not private hidden content. `unavailable` deltas do not
distinguish deletion from becoming private/unreadable. Full-note `nontake` is also
withheld conservatively for compatibility with the existing journal workflow.
`skip-ai` continues using the editor's shared block/span projection.

Editable memory is an explicit separate capability. It is refused for private
markers, raw HTML, hidden annotations, encryption or malformed markup; false
positives can require manual filesystem editing. This prevents replacing a
partial projection and silently deleting private material. Body-only updates
preserve original frontmatter; full headers must retain prior keys. Complex
headers must stay unchanged. Explicitly retained histories contain prior readable Markdown,
so deleting current memory alone does not erase history, Git or client context.

## Limits and checks

Snapshots currently cover at most 10,000 primary notes and 1 MiB serialized state.
The filesystem is scanned on demand; no background index/model is running. This
is a local personal-workspace implementation, not a large hosted archive service.
The existing filesystem checks are not an OS sandbox against a hostile local
process changing files between checks. Privacy tags govern exposure; there is no
general-purpose automatic secret detector. Do not put confidential source text
into memory filenames.

Tests use synthetic fixtures: both layouts, stable links, duplicates, privacy,
source changes, restart, hidden-memory edits, stale revisions, histories,
idempotent saves and real stdio lifecycle. No real journal is used as a fixture.
