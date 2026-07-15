# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration branch:** **`integration`** (formerly `integration/storage`). Type-display cleanup + `Client<T>` override + `Kind` drop + logs Phase 5 + ProcessStorage retirement + `NodeLogs` removal all folded. See [`whats-changed-2026-07-13.md`](archive/2026-07/features/whats-changed-2026-07-13.md).

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | `cursor/docs-corpus-phase3-ce05` | [Phase 3 plan](./agent-01-docs-corpus-phase3-plan.md) · [docs corpus](./agent-01-docs-corpus.md) | **Phase 3** — Draft rule + Stores on `integration`; next = toolkit-by-example | `integration` tip | docs:manifest:check | **Next:** P3-2 toolkit-by-example; then P3-3 processes; Batch Z deferred | 2026-07-15 |
| **2** | merged via [#33](https://github.com/NikScripts/effect-pm/pull/33) | [logs plan](archive/2026-07/agents/agent-02-logs-platform-plan.md) | **retired / merged** | `integration` tip | green | Phase 5 + `NodeLogs` closeout done; P1 handed to Agent 3 | 2026-07-14 |
| **3** | **merged to `integration`** ([#59](https://github.com/NikScripts/effect-pm/pull/59)) | [byResource full key](./agent-03-byresource-full-key.md) | **`Logs.byResource` full key shipped** — kill resource-identity `processId`/`queueId` | `integration` tip | typecheck / suite | Idle pending owner assignment | 2026-07-15 |
| **B** | from `integration` | [dashboard typesafety](./agent-b-dashboard-typesafety.md) | **plan-first** | on line | — | Owner-gated; remote `fix/dashboard-typesafety` tip was already on line (deleted) | 2026-07-14 |
| **A** | merged | [rules/docs](archive/2026-07/agents/agent-a-rules-and-documentation.md) | **merged** | on line | — | — | 2026-07-12 |
| **C** | from `integration` | [standards audit](./agent-c-standards-audit.md) | **plan-first** | on line | manifest ✓ | Owner-gated; remote `chore/standards-audit` tip was already on line (deleted) | 2026-07-14 |
| **D** | **merged to `integration`** | [named handles](./agent-d-named-handles.md) · [convergence decisions](./queue-handle-convergence-decisions.md) | **M3 shipped** | `d2d340b4b` | typecheck 0 (both) / lint 0 / 418 tests | **M3 done:** `yield* MyQueue` hovers as named `QueueResource<Item>` (Svc seam on ResourceTag + 1 harness-guarded cast in nameQueueService; `events` success now `void`). Follow-ups: M2 `.Service` unify, per-Tag success/error carriers, elide trailing default args. Agent 3 must not touch handles | 2026-07-14 |

---

## Supervisor queue

### Active (owner approval required)
1. **Agent 1:** Phase 3 legacy → live book (`cursor/docs-corpus-phase3-ce05`) — Draft content convention locked; Stores ported. Next batches: toolkit-by-example, processes placeholder. No UI / `docs/site` chrome. Ignore effect β98 fallout (Agent C).
2. **Agent D (+ peers):** named handles — do not reassign to Agent 3.

### Ready / owner calls
3. Store-layer `(scopeKey, lineId)` memo — **deferred** (tail claim is enough for live followers)
4. `main` merge + `pnpm run version` — still deferred
5. ~~[#50](https://github.com/NikScripts/effect-pm/pull/50) Logs guide~~ — **merged**

### Done this session (Agent 3)
- Process live `events` — [#47](https://github.com/NikScripts/effect-pm/pull/47) + remote proof [#51](https://github.com/NikScripts/effect-pm/pull/51) (failure surface: `Failed` + stamped `Completed`; persist == stream)
- Logs lineage append — [#48](https://github.com/NikScripts/effect-pm/pull/48)
- Closed superseded plan/brief PRs [#35](https://github.com/NikScripts/effect-pm/pull/35)/[#46](https://github.com/NikScripts/effect-pm/pull/46)

### Deferred / parked
- **ShardMap author (Cursor):** type-safety + corpus sweep **merged** to `integration` (`f269a9ce`; was [#39](https://github.com/NikScripts/effect-pm/pull/39) / [#41](https://github.com/NikScripts/effect-pm/pull/41)). Branches deleted. Corpus-complete for Agent C remit.
- Headlining resource research — **shipped** as Telemetry fleet + ShardMap (#32/#39/#41); Agent 1 moved to docs corpus
- Agent B dashboard type-safety (plan-first) — **UI reserved for lettered agents**
- Agent C standards audit (plan-first)

### Branch hygiene (2026-07-14)
Deleted 32 remotes fully contained in `integration` or abandoned closed-PR tips. DynamicConfig on `integration` (#42); still `0.8.0-beta.28`, changeset unconsumed.

**Agent 3 ready-perfection pass:** remotes cleaned; [#52](https://github.com/NikScripts/effect-pm/pull/52) close-out + [#50](https://github.com/NikScripts/effect-pm/pull/50) Logs guide **merged** to `integration`. Agent 3 idle pending new owner assignment.

---

## Completed

- [#60](https://github.com/NikScripts/effect-pm/pull/60) FleetHealth — meshed stadium-board readiness (`Reachable` / `Unreachable`)
- [#55](https://github.com/NikScripts/effect-pm/pull/55) Phase 1 handoffs archive A–D + open-asks closeout
- [#54](https://github.com/NikScripts/effect-pm/pull/54) withReadiness pipe type hygiene (P0–P3)
- [#52](https://github.com/NikScripts/effect-pm/pull/52) Agent 3 ready-perfection handoff close-out
- [#50](https://github.com/NikScripts/effect-pm/pull/50) Logs guide (narrative chapter after Stores)
- [#51](https://github.com/NikScripts/effect-pm/pull/51) Process.events remote proof (A+B+C1) + Completed.success coverage
- [#48](https://github.com/NikScripts/effect-pm/pull/48) Logs lineage append in `withScope` (idempotent leaf)
- [#47](https://github.com/NikScripts/effect-pm/pull/47) Process live `events` stream (persist == stream)
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
