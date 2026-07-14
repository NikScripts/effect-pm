# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration branch:** **`integration`** (formerly `integration/storage`). Type-display cleanup + `Client<T>` override + `Kind` drop + logs Phase 5 + ProcessStorage retirement + `NodeLogs` removal all folded. See [`whats-changed-2026-07-13.md`](./whats-changed-2026-07-13.md).

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | from `integration` | [next headlining resource](./agent-01-next-headlining-resource.md) · [#32 prototype](https://github.com/NikScripts/effect-pm/pull/32) | **plan-first** | — | — | Research / Telemetry+ShardMap prototype — owner picks; **no impl until then** | 2026-07-14 |
| **2** | merged via [#33](https://github.com/NikScripts/effect-pm/pull/33) | [logs plan](./agent-02-logs-platform-plan.md) | **retired / merged** | `integration` tip | green | Phase 5 + `NodeLogs` closeout done; P1 handed to Agent 3 | 2026-07-14 |
| **3** | **merged → `integration`** | [Logs store followers](./agent-03-logs-p1.md) · [plan](./agent-03-logs-store-followers-plan.md) | **followers cutover merged** | `501c3c3a` | typecheck / tests green | Store-layer memo **deferred**; next unlock: hard-remove interim `persistLayer`/`LogStore` | 2026-07-14 |
| **B** | from `integration` | [dashboard typesafety](./agent-b-dashboard-typesafety.md) | **plan-first** | on line | — | Owner-gated; remote `fix/dashboard-typesafety` tip was already on line (deleted) | 2026-07-14 |
| **A** | merged | [rules/docs](./agent-a-rules-and-documentation.md) | **merged** | on line | — | — | 2026-07-12 |
| **C** | from `integration` | [standards audit](./agent-c-standards-audit.md) | **plan-first** | on line | manifest ✓ | Owner-gated; remote `chore/standards-audit` tip was already on line (deleted) | 2026-07-14 |
| **D** | **merged to `integration`** | [named handles](./agent-d-named-handles.md) · [convergence decisions](./queue-handle-convergence-decisions.md) | **M3 shipped** | `d2d340b4b` | typecheck 0 (both) / lint 0 / 418 tests | **M3 done:** `yield* MyQueue` hovers as named `QueueResource<Item>` (Svc seam on ResourceTag + 1 harness-guarded cast in nameQueueService; `events` success now `void`). Follow-ups: M2 `.Service` unify, per-Tag success/error carriers, elide trailing default args. Agent 3 must not touch handles | 2026-07-14 |

---

## Supervisor queue

### Active (owner approval required)
1. **Agent 3:** [#40](https://github.com/NikScripts/effect-pm/pull/40) **merged** to `integration` (`501c3c3a`) — next unlock **hard-remove** interim `Logs.persistLayer` / standalone `LogStore` (store-layer `lineId` memo deferred).
2. **Agent 1:** next headlining resource research / [#32](https://github.com/NikScripts/effect-pm/pull/32) prototype — owner picks direction.
3. **Agent D (+ peers):** named handles — do not reassign to Agent 3.

### Ready / owner calls
4. Hard-remove `persistLayer` / `LogStore` after shim window (compat tests still cover deprecated path)
5. Store-layer `(scopeKey, lineId)` memo — **deferred** (tail claim is enough for live followers)
6. `main` merge + `pnpm run version` — still deferred
7. Process live `events` (#20) — needs failure-surface decision

### Deferred / parked
- **ShardMap author (Cursor):** type-safety + corpus sweep **merged** to `integration` (`f269a9ce`; was [#39](https://github.com/NikScripts/effect-pm/pull/39) / [#41](https://github.com/NikScripts/effect-pm/pull/41)). Branches deleted. Corpus-complete for Agent C remit.
- Agent B dashboard type-safety (plan-first)
- Agent C standards audit (plan-first)
- `Store.layerQuery` (not approved)
- Headlining resource **implementation** (after Agent 1 + owner pick)

### Branch hygiene (2026-07-14)
Deleted 32 remotes fully contained in `integration` or abandoned closed-PR tips. **Kept while landing:** Agent 3 [#40](https://github.com/NikScripts/effect-pm/pull/40) / [#35](https://github.com/NikScripts/effect-pm/pull/35). DynamicConfig on `integration` (#42); still `0.8.0-beta.28`, changeset unconsumed.

---

## Completed

- [#40](https://github.com/NikScripts/effect-pm/pull/40) Durable store tails — `Node.logs`, registration followers, Storage-first reads, stream levels, remote NodeStatus path; examples/docs off `persistLayer`
- [#33](https://github.com/NikScripts/effect-pm/pull/33) Logs closeout — `NodeLogs` shim removed; Agent 2 retired
- [#30](https://github.com/NikScripts/effect-pm/pull/30) Phase 5 Logs — `captureLogs` / handle `logs` removed
- ProcessStorage / RuntimeStorage / ProcessLifecycleStore facet substrate **retired**
- [#26](https://github.com/NikScripts/effect-pm/pull/26) Process `run` RPC + effect/effectFn
- [#23–#25](https://github.com/NikScripts/effect-pm/pull/23) queue ref + node status + tag schemas

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`.
