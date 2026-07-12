# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration tip:** `c3d5054` — Phase 1a + Session 3 consumer docs merged

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | `integration/storage` | [session-2 storage docs](./agent-01-session-2-storage-docs.md) | **merged** | Session 3 in line | typecheck + lint green | `pnpm run version` when owner ready | 2026-07-11 |
| **2** | `cursor/process-run-rpc-a009` (next) | [process run RPC](./agent-02-process-run-rpc.md) | **ready-to-start** | — | Phase 1a + #17 merged | `effect: Resource.effect` (no payload); not effect=query | 2026-07-12 |
| **B** | `action/html-doc-platform` → merged | [plan](./agent-b-plan.md) | **merged** | on integration line | islands live; docs site on merged tree | Queue handle ref follow-up | 2026-07-11 |
| **A** | `docs/standards-corpus` → `integration/rules-and-documentation` | [brief](./agent-a-rules-and-documentation.md) | **corpus complete** | 9 pages / 104 rules + `docs/standards/manifest.json` | renders on docs:serve; manifest derived | ready for Agent C — corpus must reach `integration/storage` | 2026-07-11 |
| **C** | `chore/standards-audit` from `integration/storage` | [brief](./agent-c-standards-audit.md) | **step 0 done** | manifest now generator-derived; `appliesTo` multi-scope (58 rules gain `examples`); appliesTo chip | docs build ✓; `docs:manifest --check` ✓; 104 rules intact | audit catalog next (owner-gated) | 2026-07-12 |

---

## Supervisor queue

1. ~~Agent 1 Session 3~~ — merged on integration line
2. ~~Agent 2 Phase 1a~~ — merged [#21](https://github.com/NikScripts/effect-pm/pull/21)
3. ~~PR #17~~ — Session 3 consumer docs merged (`docs/legacy/`) — **revoke RPC defer** when process-run-rpc lands
4. **Agent 2:** [`agent-02-process-run-rpc.md`](./agent-02-process-run-rpc.md) — `run`/`effect` replaces `runImmediately`
5. **Future:** merge with other integration branch (owner timeline)

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`.
