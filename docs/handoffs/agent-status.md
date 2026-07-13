# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration branch:** **`integration`** (formerly `integration/storage`). Type-display cleanup + `Client<T>` override + `Kind` drop + logs Phase 5 + ProcessStorage retirement + `NodeLogs` removal all folded or queued. See [`whats-changed-2026-07-13.md`](./whats-changed-2026-07-13.md).

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | from `integration` | [next headlining resource](./agent-01-next-headlining-resource.md) | **plan-first** | — | — | Research fleet/peers headline — owner picks; **no code until then** | 2026-07-14 |
| **2** | `cursor/logs-closeout-a3ad` | [logs plan](./agent-02-logs-platform-plan.md) · [PR #30 review](./phase5-logs-migration-review.md) · [PR #33](https://github.com/NikScripts/effect-pm/pull/33) | **closeout — ready** | `d7927960` | `typecheck` + `test` + `lint` green | Phase 5 merged (#30); substrate retired; `NodeLogs` removed; **P1 still owner-gated** | 2026-07-14 |
| **B** | merged / brief | [dashboard typesafety](./agent-b-dashboard-typesafety.md) | **plan-first** | on line | — | Owner-gated | 2026-07-13 |
| **A** | merged | [rules/docs](./agent-a-rules-and-documentation.md) | **merged** | on line | — | — | 2026-07-12 |
| **C** | `chore/standards-audit` | [standards audit](./agent-c-standards-audit.md) | **plan-first** | on line | manifest ✓ | Owner-gated | 2026-07-13 |
| **D** | `action/named-handles` from `integration` | [named handles](./agent-d-named-handles.md) | **plan-first** | — | — | Phase 1 (queue) first, then fan out one agent per resource; D3 dual-view = top doc-UI item | 2026-07-13 |

---

## Supervisor queue

### Active (owner approval required)
1. **Agent 1:** [`agent-01-next-headlining-resource.md`](./agent-01-next-headlining-resource.md) — research next headlining resource (fleet/peers from day one). **No code until owner picks.**
2. **Agent 2:** Logs closeout PR (`cursor/logs-closeout-a3ad`) — remove public `NodeLogs` shim + pristine handoffs; **do not expand into Logs P1**

### Ready / next (no active Agent 2 engine work after closeout merges)
3. Logs P1 (level pipes / store followers / remote `Resource.logs`) — only if owner wants that model
4. CustomQueue / Run mechanical store polish
5. `main` merge + `pnpm run version` — still deferred

### Deferred
- Agent B dashboard type-safety (plan-first)
- Agent C standards audit (plan-first)
- Process live `events` (#20)
- `Store.layerQuery` (not approved)
- Implementation of next headlining resource (after Agent 1 research + owner pick)

---

## Completed

- [#30](https://github.com/NikScripts/effect-pm/pull/30) Phase 5 Logs — `captureLogs` / handle `logs` removed; `Resource.logs` / `NodeStatus.logs`; P0 review addressed
- ProcessStorage / RuntimeStorage / ProcessLifecycleStore facet substrate **retired** (on #30 tip, folded into `integration`)
- [#26](https://github.com/NikScripts/effect-pm/pull/26) Process `run` RPC + effect/effectFn
- Integration fold `4c543c8` (standards/docs group)
- [#23–#25](https://github.com/NikScripts/effect-pm/pull/23) queue ref + node status + tag schemas
- Logs store cutover (`LogStore` → `Store.contract` / `Store.Service`) — on #30

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`.
