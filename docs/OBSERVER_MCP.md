# Personal observer through the notes MCP

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
enabled_tools = ["prepare_context", "list_notes", "read_note", "search_notes", "list_changes", "read_memory", "write_memory", "save_artifact", "list_agent_folder"]
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
- `conversation`: ask one useful question and follow the answer.

The person need not title or classify their thoughts. One note can contain many
topics; daily review boundaries can cross midnight. Writing more and analyzing
more are not goals in themselves. Respect requests not to save and do not turn
every session into more homework.

## Agent workflow

1. `prepare_context` returns the complete available `me/overview.md`, corrections,
   optional `agent/preferences.md` and `agent/session.md`, recent source previews
   and working-memory references. Read sources with `read_note`. The server does
   not silently shorten overview; missing/unavailable memory is explicit.
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
   notes. `structure` is excluded from prepared observer context.
4. `save_artifact` records an analysis/review/observation/morning_note with exactly
   the source IDs and revisions actually used. Reviews require reviewType and
   explicit periodStart/periodEnd (dates or ISO times with offsets); mark uncertain
   or unfinished days partial. Reuse a stable key, e.g. `week:2026-09-14`.
   An identical retry returns the existing artifact; changed content requires
   the expectedRevision obtained through `read_memory(area:"agent", path, editable:true)`.
5. `read_memory(area:"me",path:"overview.md",editable:true)` returns complete
   editable Markdown and revision. `write_memory` updates with that revision,
   or creates when it is absent. Cite source revisions; a direct conversation
   clarification may have an empty source list with the explanation in `reason`.
   Keep facts, dated self-reports and hypotheses distinct. Updating memory is not
   proof that the user's interpretation or the agent's conclusion is correct.
6. Preserve useful unfinished work in agent via write_memory or save_artifact.
   Keep a brief `agent/session.md` recording the latest relevant snapshot ID,
   completed artifact paths, actual coverage and what remains. Do not advance a
   "fully reviewed" cursor merely because list_changes produced a snapshot.
   The next fresh agent receives this handoff from prepare_context.

Useful directories (relative to the resolved memory areas):

```text
me/overview.md
agent/corrections.md
agent/preferences.md          optional user instructions for personal sessions
agent/session.md              concise continuation / actual coverage
agent/artifacts/<key-hash>.md  generated reviews and analyses
agent/history/...             prior editable memory/artifact versions
agent/memory-updates/...       rationale + sources, labeled as update intentions
agent/observer-state/...       source inventory snapshots
```

History and internal state do not enter ordinary note discovery. They remain
available through explicit memory reads/filesystem inspection. Original journal
notes are never writable through the observer API. A failed write can leave an
intent receipt or retained old version; neither claims the update succeeded.

## Source identity and privacy

Opaque IDs survive server restart and rename for a unique valid frontmatter UUID
within an area. Stream IDs also survive Feed→_system/stream migration under the
same notes root. Duplicate UUIDs remain separate, with `identityAmbiguous:true`;
notes lacking a unique UUID use path identity and may change ID on rename.
Moving the entire notes root changes its namespace: re-baseline snapshots after
that move. No raw filename or original frontmatter is exposed by source reads.
The returned URI is a logical reference: pass its UUID to read_note; this version
does not register an MCP resources/read handler for it.

Revisions for sources hash permitted text and allowlisted metadata. They identify
what the agent could read, not private hidden content. `unavailable` deltas do not
distinguish deletion from becoming private/unreadable. Full-note `nontake` is also
withheld conservatively for compatibility with the existing journal workflow.
`skip-ai` continues using the editor's shared block/span projection.

Editable memory is an explicit separate capability. It is refused for private
markers, raw HTML, hidden annotations, encryption or malformed markup; false
positives can require manual filesystem editing. This prevents replacing a
partial projection and silently deleting private material. Body-only updates
preserve original frontmatter; full headers must retain prior keys. Complex
headers must stay unchanged. Memory histories contain prior readable Markdown,
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
