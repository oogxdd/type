# Personal agent: implementation journal

Product specification: [PERSONAL_AGENT.md](PERSONAL_AGENT.md).
Operational MCP guide: [OBSERVER_MCP.md](OBSERVER_MCP.md).

## Baseline — 2026-09-24

The existing observer provides filtered source reads, change inventories,
editable me/agent memory and idempotent artifacts. Baseline: 41 MCP tests and
the notes-mcp TypeScript check pass. Reviews currently live in agent/artifacts;
source identifiers include the absolute root, and projections discard headings
and links. Memory writes unconditionally retain previous versions.

## Implementation stages

| Stage | Status | Result |
| --- | --- | --- |
| Product documentation | Complete | Agreed memory model and deferred choices recorded |
| Portable references and document structure | Complete | UUID identity, filtered outline/ranges, citation resolution |
| Memory navigation and summaries | Complete | Scoped operations, selectable summaries, source dependencies |
| Hierarchical reviews | Complete | Dedicated area, periods, coverage, compatible old artifacts |
| End-to-end verification | Complete | Synthetic source → reviews → me → summaries → source |
| OpenAI brain MCP and local voice screen | Complete, API live check pending | GPT-Live client delegation, configurable Responses brain and Notes MCP tool loop |
| Context recipes and application UI | Deferred | Exact source selection, Tauri/Expo integration and schedules require separate decisions |

## Decisions

- Markdown remains authoritative; no model or background schedule in the Notes MCP.
- The Notes MCP remains model-free. A separate brain MCP uses OpenAI Responses,
  starting with `gpt-6-luna`; `gpt-live-1` handles voice through a local WebRTC
  page and delegates reasoning to the brain. See [TYPE_BRAIN.md](TYPE_BRAIN.md).
- The agent evolves me autonomously; Git is the main history. Retaining previous
  editable versions becomes an explicit option, while revision conflict checks stay.
- Citations pin a filtered text revision; changed/unavailable sources are reported.
  Source bodies are not copied into a new historical archive.
- Navigation targets the current document/heading. No automatic relocation of a
  citation to different words, and no silent merge of duplicate UUIDs.
- Evidence and contextual dependencies have explicit roles. Generated documents
  do not become independent primary evidence.
- Legacy layouts and documents remain readable; startup never migrates them.
- Stream stays read-only: review status lives in artifacts, not in source front
  matter. Alternative considered: [AI_REVIEWED_FLAG_ALTERNATIVE.md](AI_REVIEWED_FLAG_ALTERNATIVE.md).

## Journal

### 2026-09-24 — specification

Recorded the approved product model, implementation order and intentional future
decisions. Next: implement the shared reference format and structured privacy
projection, then memory/review operations and integration tests.

### 2026-09-24 — memory and review MCP

Implemented portable area-scoped UUID references, filtered headings/line ranges,
explicit citation resolution and dependencies, `me` navigation and summaries,
dedicated `reviews` with period/coverage metadata, optional retained versions and
legacy artifact compatibility. The Rust tree hides/protects reviews. Verified a
synthetic source → daily → weekly → me → summary → citation workflow through the
real stdio server, with originals unchanged. All 581 TypeScript tests, 92 Rust
library tests and workspace typechecks passed in that stage.

### 2026-09-25 — OpenAI brain and voice

Added a separate `run_personal_agent` MCP server. It calls Notes MCP through a
real in-memory MCP transport, prepares filtered context, invokes configurable
OpenAI Responses (`gpt-6-luna` default), and dispatches read/write tools. A
per-task source ledger requires declared dependencies to have been read; derived
documents must use context role. A no-save request removes write tools. Added a
local WebRTC page for `gpt-live-1` with client delegation to brain, text input,
same-origin checks and graceful session close. Voice transcripts stay in page
memory. API key remains server-side. Synthetic API and MCP tests passed; an
actual OpenAI Live session remains untested because no API key is configured in
the test environment. All 587 TypeScript tests and workspace typechecks passed;
the page loaded in a browser with no script errors, and its missing-key state
displayed correctly. A synthetic browser event exercise verified transcript →
delegation request → spoken result → graceful close. The built brain process
passed the stdio smoke without an API key. Next: real account smoke with user-supplied environment
key, then product decisions on context recipes and app integration.

Update this journal after each completed implementation stage: what changed,
why, checks performed, remaining limitations and the next concrete step. Keep
implemented capabilities distinct from the roadmap. Record commit IDs only
when actual commits have been made.
