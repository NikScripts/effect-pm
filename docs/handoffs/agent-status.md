# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration tip:** merge **PR #19** then **PR #20** into `integration/storage` — see [Session 4 handoff](./agent-02-session-4-queue-process-events.md).

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | `integration/storage` | [session-2 storage docs](./agent-01-session-2-storage-docs.md) | **merged** | `0cc196f` | typecheck + 440 tests + lint green | **`pnpm run version`** when owner ready; `STORAGE.md` deep pass | 2026-07-11 |
| **2** | `cursor/process-events-stream-a009` | [session-4 queue+process events](./agent-02-session-4-queue-process-events.md) | **PR #19 + #20 draft** | `ba427d8` | typecheck + 440 tests | Merge PRs; changeset; Queue/Process store Phase 2; store naming cleanup | 2026-07-11 |
| **B** | `action/html-doc-platform` | [html doc platform](./agent-b-html-doc-platform.md) | **planning** | `dac86513` (local) | Pull `9042ce4` first | Slice 0 conversation; Slice 1 kept as spike; stash Slice 2 WIP | 2026-07-09 |
| **A** | — | [html standards](./agent-a-html-standards-corpus.md) | **blocked** | — | — | Blocked on Agent B | 2026-07-09 |
| **C** | — | [standards audit](./agent-c-standards-audit.md) | **blocked** | — | — | Blocked on Agent A | 2026-07-09 |

---

## Supervisor queue

1. **Merge PR #19** (`cursor/queue-spec-wire-a009`) — Queue typed `events` RPC wire → `integration/storage`
2. **Rebase + merge PR #20** (`cursor/process-events-stream-a009`) — Process live `events` stream
3. **Owner:** approve **changeset** + `pnpm run version` (both PRs change public wire behavior)
4. **Follow-up (new work):** Queue + Process **store Phase 2** (tier-1 typing); store module **naming/layout** (`facetStore`, `spine`) — see [session-4 handoff](./agent-02-session-4-queue-process-events.md)
5. **Agent 1:** `STORAGE.md` + release hygiene when owner ready
6. **Agent B:** Slice 0 planning → `action/html-doc-platform`
7. ~~Delete merged `cursor/store-release-hygiene-a009` remote~~ — after owner OK

**Earlier (done):** Agent 1 Session 3 → `7a3f7fa` · Agent 2 Session 2 → `3ffa635` · Process consumer docs PR #17 (confirm merged on GitHub)

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`. Agents append there; this board stays one row per agent.
