# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration tip:** `9042ce4` (update when supervisor merges)

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | — | [session-2 storage docs](./agent-01-session-2-storage-docs.md) | **merged** | `94a157b` | typecheck + 438 tests | Idle — optional Session 3 release hygiene | 2026-07-09 |
| **2** | — | [session-2 process](./agent-02-session-2-process-platform.md) | **merged** | `0802947` | typecheck + 438 tests | Idle — RPC error wire owner decision | 2026-07-09 |
| **B** | `action/html-doc-platform` | [plan](./agent-b-plan.md) · [handoff](./agent-b-html-doc-platform.md) | **building (Slice 1)** | (pushing) | Slice 0 ✅ spike proved Djot→Effect→Waku RSC→SSG (waku beta.3); plan approved by owner | Building Waku app + HMR gate | 2026-07-09 |
| **A** | — | [html standards](./agent-a-html-standards-corpus.md) | **blocked** | — | — | Blocked on Agent B | 2026-07-09 |
| **C** | — | [standards audit](./agent-c-standards-audit.md) | **blocked** | — | — | Blocked on Agent A | 2026-07-09 |

---

## Supervisor queue

1. ~~Rebase + merge Agent 1 → `integration/storage`~~ ✅ `3ffa635`
2. ~~Rebase + merge Agent 2 → `integration/storage`~~ ✅ `3ffa635`
3. **Agent B:** Slice 0 planning conversation → `agent-b-plan.md` → then `action/html-doc-platform`
4. Agent A: after B merges
5. Delete merged `cursor/store-platform-docs-a009` + `cursor/process-platform-a009` remotes after push

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`. Agents append there; this board stays one row per agent.
