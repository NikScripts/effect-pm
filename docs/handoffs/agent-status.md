# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration branch:** **`integration`** (formerly `integration/storage`). Type-display cleanup + `Client<T>` override + `Kind` drop + logs Phase 5 + ProcessStorage retirement + `NodeLogs` removal all folded. See [`whats-changed-2026-07-13.md`](./whats-changed-2026-07-13.md).

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | from `integration` | [docs corpus](./agent-01-docs-corpus.md) | **plan-first (Phase 1)** | — | — | Handoffs cleanup inventory — UI/site reserved for lettered agents | 2026-07-14 |
| **2** | merged via [#33](https://github.com/NikScripts/effect-pm/pull/33) | [logs plan](./agent-02-logs-platform-plan.md) | **retired / merged** | `integration` tip | green | Phase 5 + `NodeLogs` closeout done; P1 handed to Agent 3 | 2026-07-14 |
| **3** | **merged → `integration`** | [Logs store followers](./agent-03-logs-p1.md) · [plan](./agent-03-logs-store-followers-plan.md) | **persistLayer/LogStore removed** | [#43](https://github.com/NikScripts/effect-pm/pull/43) | typecheck / 444 tests | Store-layer memo deferred | 2026-07-14 |
| **B** | from `integration` | [dashboard typesafety](./agent-b-dashboard-typesafety.md) | **plan-first** | on line | — | Owner-gated; remote `fix/dashboard-typesafety` tip was already on line (deleted) | 2026-07-14 |
| **A** | merged | [rules/docs](./agent-a-rules-and-documentation.md) | **merged** | on line | — | — | 2026-07-12 |
| **C** | from `integration` | [standards audit](./agent-c-standards-audit.md) | **plan-first** | on line | manifest ✓ | Owner-gated; remote `chore/standards-audit` tip was already on line (deleted) | 2026-07-14 |
| **D** | **merged to `integration`** | [named handles](./agent-d-named-handles.md) · [convergence decisions](./queue-handle-convergence-decisions.md) | **M3 shipped** | `d2d340b4b` | typecheck 0 (both) / lint 0 / 418 tests | **M3 done:** `yield* MyQueue` hovers as named `QueueResource<Item>` (Svc seam on ResourceTag + 1 harness-guarded cast in nameQueueService; `events` success now `void`). Follow-ups: M2 `.Service` unify, per-Tag success/error carriers, elide trailing default args. Agent 3 must not touch handles | 2026-07-14 |

---

## Supervisor queue

### Active (owner approval required)
1. **Agent 1:** [`agent-01-docs-corpus.md`](./agent-01-docs-corpus.md) — handoffs cleanup (**Phase 1 plan-first**); then plans refactor; then legacy port + Draft label (later unlocks). **No UI / `docs/site` chrome.**
2. **Agent 3:** [#43](https://github.com/NikScripts/effect-pm/pull/43) hard-removes interim `Logs.persistLayer` / `LogStore` (followers already on `integration`; store-layer `lineId` memo deferred).
3. **Agent D (+ peers):** named handles — do not reassign to Agent 3.

### Ready / owner calls
4. Store-layer `(scopeKey, lineId)` memo — **deferred** (tail claim is enough for live followers)
5. `main` merge + `pnpm run version` — still deferred
6. Process live `events` (#20) — needs failure-surface decision

### Deferred / parked
- **ShardMap author (Cursor):** type-safety + corpus sweep **merged** to `integration` (`f269a9ce`; was [#39](https://github.com/NikScripts/effect-pm/pull/39) / [#41](https://github.com/NikScripts/effect-pm/pull/41)). Branches deleted. Corpus-complete for Agent C remit.
- Headlining resource research — **shipped** as Telemetry fleet + ShardMap (#32/#39/#41); Agent 1 moved to docs corpus
- Agent B dashboard type-safety (plan-first) — **UI reserved for lettered agents**
- Agent C standards audit (plan-first)

### Branch hygiene (2026-07-14)
Deleted 32 remotes fully contained in `integration` or abandoned closed-PR tips. DynamicConfig on `integration` (#42); still `0.8.0-beta.28`, changeset unconsumed.

---

## Completed

- [#43](https://github.com/NikScripts/effect-pm/pull/43) Remove interim `Logs.persistLayer` + standalone `LogStore` / `store/Log` subpath
- [#40](https://github.com/NikScripts/effect-pm/pull/40) Durable store tails — `Node.logs`, registration followers, Storage-first reads, stream levels, remote NodeStatus path
- [#33](https://github.com/NikScripts/effect-pm/pull/33) Logs closeout — `NodeLogs` shim removed; Agent 2 retired
- [#30](https://github.com/NikScripts/effect-pm/pull/30) Phase 5 Logs — `captureLogs` / handle `logs` removed
- ProcessStorage / RuntimeStorage / ProcessLifecycleStore facet substrate **retired**
- [#26](https://github.com/NikScripts/effect-pm/pull/26) Process `run` RPC + effect/effectFn
- [#23–#25](https://github.com/NikScripts/effect-pm/pull/23) queue ref + node status + tag schemas

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`.
