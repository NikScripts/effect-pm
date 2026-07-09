# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration tip:** `884d901` (update when supervisor merges)

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | `cursor/store-platform-docs-a009` | [session-2 storage docs](./agent-01-session-2-storage-docs.md) | **ready-for-merge** | `2a7c6bb` | typecheck + 437 tests (supervisor) | Rebase onto `884d901` or drops `docs/site/`; `guides/store.md` + `PACKAGE-GUIDE.md` not swept; lint unconfirmed | 2026-07-09 |
| **2** | `cursor/process-platform-a009` | [session-2 process](./agent-02-session-2-process-platform.md) | **ready-for-merge** | `0802947` | typecheck + 438 tests (supervisor) | Rebase onto `884d901`; RPC error wire blocked (documented); STORAGE.md overlap with Agent 1 | 2026-07-09 |
| **B** | — | [html doc platform](./agent-b-html-doc-platform.md) | **paused** | — | — | **Decision:** [`docs-platform-architecture-decision.md`](./docs-platform-architecture-decision.md) | 2026-07-09 |
| **A** | — | [html standards](./agent-a-html-standards-corpus.md) | **blocked** | — | — | Blocked on Agent B | 2026-07-09 |
| **C** | — | [standards audit](./agent-c-standards-audit.md) | **blocked** | — | — | Blocked on Agent A | 2026-07-09 |

---

## Supervisor queue

1. Rebase + merge Agent 1 → `integration/storage`
2. Rebase + merge Agent 2 → `integration/storage`
3. Agent B: `action/html-doc-platform` — **PAUSED** pending [`docs-platform-architecture-decision.md`](./docs-platform-architecture-decision.md)
4. Agent A: after B merges
5. Delete merged `cursor/*` branches after merge (see [branch-cleanup-manifest](./branch-cleanup-manifest.md))

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`. Agents append there; this board stays one row per agent.
