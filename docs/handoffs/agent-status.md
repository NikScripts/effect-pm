# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration tip:** `9042ce4` (update when supervisor merges)

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | — | [session-2 storage docs](./agent-01-session-2-storage-docs.md) | **merged** | `94a157b` | typecheck + 438 tests | Idle — optional Session 3 release hygiene | 2026-07-09 |
| **2** | `cursor/process-consumer-docs-a009` | [session-2 process](./agent-02-session-2-process-platform.md) + Session 3 consumer docs | **ready-for-merge** | `b7124a1` | typecheck + 438 tests | Owner defer on RPC `error` wire (recommended); no `processSpec` rebuild unless funded; PR #17 | 2026-07-10 |
| **B** | `action/html-doc-platform` | [html doc platform](./agent-b-html-doc-platform.md) | **planning** | `dac86513` (local) | Pull `9042ce4` first | Slice 0 conversation; Slice 1 kept as spike; stash Slice 2 WIP | 2026-07-09 |
| **A** | — | [html standards](./agent-a-html-standards-corpus.md) | **blocked** | — | — | Blocked on Agent B | 2026-07-09 |
| **C** | — | [standards audit](./agent-c-standards-audit.md) | **blocked** | — | — | Blocked on Agent A | 2026-07-09 |

---

## Supervisor queue

1. ~~Rebase + merge Agent 1 → `integration/storage`~~ ✅ `3ffa635`
2. ~~Rebase + merge Agent 2 → `integration/storage`~~ ✅ `3ffa635`
3. **Agent B:** Slice 0 planning conversation → `agent-b-plan.md` → then `action/html-doc-platform`
4. Agent A: after B merges
5. Delete merged `cursor/store-platform-docs-a009` + `cursor/process-platform-a009` remotes after push
6. **Agent 2:** merge `cursor/process-consumer-docs-a009` (Session 3 consumer docs, PR #17) when owner confirms defer

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`. Agents append there; this board stays one row per agent.
