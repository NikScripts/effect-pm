# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration branch:** now **`integration`** (renamed from `integration/storage` — storage work done, general line). Type-display cleanup + `Client<T>` override + `Kind` drop + logs Phase 5 all folded. See [`whats-changed-2026-07-13.md`](./whats-changed-2026-07-13.md).

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | from `cursor/phase5-logs-migration-a3ad` | [next headlining resource](./agent-01-next-headlining-resource.md) | **plan-first** | — | — | Branch **from Agent 2 tip**; research fleet/peers headline — owner picks | 2026-07-13 |
| **2** | `cursor/phase5-logs-migration-a3ad` | [logs plan](./agent-02-logs-platform-plan.md) · [PR #30 review](./phase5-logs-migration-review.md) | **PR open — P0 done** | on branch | `typecheck` + `test` + `lint` green | P1 platform gaps owner-gated (do not expand without approval) | 2026-07-13 |
| **B** | merged / brief | [dashboard typesafety](./agent-b-dashboard-typesafety.md) | **plan-first** | on line | — | Owner-gated | 2026-07-13 |
| **A** | merged | [rules/docs](./agent-a-rules-and-documentation.md) | **merged** | on line | — | — | 2026-07-12 |
| **C** | `chore/standards-audit` | [standards audit](./agent-c-standards-audit.md) | **plan-first** | on line | manifest ✓ | Owner-gated | 2026-07-13 |
| **D** | `action/named-handles` from `integration` | [named handles](./agent-d-named-handles.md) | **plan-first** | — | — | Phase 1 (queue) first, then fan out one agent per resource; D3 dual-view = top doc-UI item | 2026-07-13 |

---

## Supervisor queue

### Active (owner approval required)
1. **Agent 1:** [`agent-01-next-headlining-resource.md`](./agent-01-next-headlining-resource.md) — research next headlining resource (fleet/peers from day one). **No code until owner picks.**
2. **Agent 2:** PR [#30](https://github.com/NikScripts/effect-pm/pull/30) — Phase 5 Logs; **P0 from [`phase5-logs-migration-review.md`](./phase5-logs-migration-review.md) addressed** — ready for merge when owner agrees; P1 deferred

### After Logs merge
3. Delete `ProcessLifecycleStore` + retire facet substrate
4. Logs P1 (level pipes / store followers / remote `Resource.logs`) if owner wants that model
5. CustomQueue / Run mechanical store polish
6. Remove public `NodeLogs` shim when migration window ends
7. `main` merge + `pnpm run version` — still deferred

### Deferred
- Agent B dashboard type-safety (plan-first)
- Agent C standards audit (plan-first)
- Process live `events` (#20)
- `Store.layerQuery` (not approved)
- Implementation of next headlining resource (after Agent 1 research + owner pick)

---

## Completed

- [#26](https://github.com/NikScripts/effect-pm/pull/26) Process `run` RPC + effect/effectFn
- Integration fold `4c543c8` (standards/docs group)
- [#23–#25](https://github.com/NikScripts/effect-pm/pull/23) queue ref + node status + tag schemas
- Logs store cutover (`LogStore` → `Store.contract` / `Store.Service`) — on #30

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`.
