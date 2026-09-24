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
| Portable references and document structure | In progress | UUID identity, filtered outline/ranges, citation resolution |
| Memory navigation and summaries | Planned | Scoped operations, selectable summaries, source dependencies |
| Hierarchical reviews | Planned | Dedicated area, periods, coverage, compatible old artifacts |
| End-to-end verification | Planned | Synthetic source → reviews → me → summaries → source |
| Context recipes and application UI | Deferred | Requires separate product decisions |

## Decisions

- Markdown remains authoritative; no model or background schedule in the MCP.
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

Update this journal after each completed implementation stage: what changed,
why, checks performed, remaining limitations and the next concrete step. Keep
implemented capabilities distinct from the roadmap. Record commit IDs only
when actual commits have been made.
