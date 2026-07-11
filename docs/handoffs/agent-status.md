# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration tip:** `integration/storage` — see git tip after doc push

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | `integration/storage` | [session-2 storage docs](./agent-01-session-2-storage-docs.md) | **merged** | Session 3 in line | typecheck + lint green | `pnpm run version` when owner ready | 2026-07-11 |
| **2** | `cursor/queue-wire-phase-1a-a009` (new) | [queue wire Phase 1a](./agent-02-queue-wire-phase-1a.md) | **ready-to-start** | — | — | **Do not merge PR #19/#20**; validation + CQR mirror | 2026-07-11 |
| **B** | `action/html-doc-platform` → merged to `integration/storage` | [plan](./agent-b-plan.md) on branch | **merged** | (this merge) | islands live (Counter/Queue/RunResource), HMR-safe module split, no casts; docs render on merged tree | QueueResource handle not a proper `ref` → real widgets show no data → handoff prepped | 2026-07-11 |
| **A** | `integration/rules-and-documentation` → merged to `integration/storage` | [html standards](./agent-a-html-standards-corpus.md) | **merged** | (this merge) | standards corpus chapters 1–7 + prioritized inventory | — | 2026-07-11 |

---

## Supervisor queue

1. ~~Agent 1 Session 3~~ — merged on integration line
2. **Hold PR #19 / #20** — superseded by Phase 1a ([`owner-decisions.md`](./owner-decisions.md))
3. **Agent 2:** Queue wire Phase 1a — new branch per handoff
4. **PR #17** (Session 3 consumer docs) — merge after Queue Phase 1a + supervisor verify
5. **Agent B merge** — when owner says

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`.
