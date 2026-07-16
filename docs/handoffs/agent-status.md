# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration branch:** **`integration`** (formerly `integration/storage`). Type-display cleanup + `Client<T>` override + `Kind` drop + logs Phase 5 + ProcessStorage retirement + `NodeLogs` removal all folded. See [`whats-changed-2026-07-13.md`](archive/2026-07/features/whats-changed-2026-07-13.md).

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | `cursor/docs-corpus-phase3-ce05` | [Examples book](./agent-01-examples-book.md) · [Phase 3](./agent-01-docs-corpus-phase3-plan.md) | **E1 in flight** — Examples hub + queue Twoslash pairs | branch tip | hub + 2 queue docs | **Next:** E2 forms/resource pairs | 2026-07-15 |
| **2** | merged via [#33](https://github.com/NikScripts/effect-pm/pull/33) | [logs plan](archive/2026-07/agents/agent-02-logs-platform-plan.md) | **retired / merged** | `integration` tip | green | Phase 5 + `NodeLogs` closeout done; P1 handed to Agent 3 | 2026-07-14 |
| **3** | Soft stack on `integration` | [cutover follow-through](./agent-03-storage-cutover-followthrough.md) · [stores guide](../guides/stores.md) · [#62](https://github.com/NikScripts/effect-pm/pull/62)/[#65](https://github.com/NikScripts/effect-pm/pull/65) | **idle** — Soft bake+override + follow-through merged | `integration` tip | Soft guards on line | Fail-loud Soft / memo / handles still parked; β98 = Agent C | 2026-07-15 |
| **B** | from `integration` | [dashboard typesafety](./agent-b-dashboard-typesafety.md) | **plan-first** | on line | — | Owner-gated; remote `fix/dashboard-typesafety` tip was already on line (deleted) | 2026-07-14 |
| **A** | merged | [rules/docs](archive/2026-07/agents/agent-a-rules-and-documentation.md) | **merged** | on line | — | — | 2026-07-12 |
| **C** | from `integration` | [standards audit](./agent-c-standards-audit.md) | **plan-first** | on line | manifest ✓ | Owner-gated; remote `chore/standards-audit` tip was already on line (deleted) | 2026-07-14 |
| **D** | **merged to `integration`** | [named handles](./agent-d-named-handles.md) · [convergence decisions](./queue-handle-convergence-decisions.md) | **M3 shipped** | `d2d340b4b` | typecheck 0 (both) / lint 0 / 418 tests | **M3 done:** `yield* MyQueue` hovers as named `QueueResource<Item>` (Svc seam on ResourceTag + 1 harness-guarded cast in nameQueueService; `events` success now `void`). Follow-ups: M2 `.Service` unify, per-Tag success/error carriers, elide trailing default args. Agent 3 must not touch handles | 2026-07-14 |
| **E** | work branch from `integration` | [impossible-states](./impossible-states-proposal.md) · [loud-failures](./loud-failures-design.md) | **P2 in flight** | on line | topology + verifyConnection merged (`d554ec212`); 515 tests green | **Owner-reserved (2026-07-16):** `src/Resource.ts` node/client typing (`NodeKey`/`AnyNode`/`AddressedNode`/`makeNode`/`connect*`/`clientLayer`/`socketClient`/`verifyConnection`) + `NodeStatus` wiring. All other agents (incl. C) route around it. `test/transport-harness` (conformance + fleet smoke) also awaiting sync | 2026-07-16 |

---

## Supervisor queue

### Reserved — hands off (2026-07-16, owner-assigned)
0. **Agent E:** impossible-states plan ([`impossible-states-proposal.md`](./impossible-states-proposal.md)). **P1 DONE** (node↔protocol wiring bug → compile error, cast-free) + **P5 DONE** (http transport dies in browser) — both merged. **P2 SKIPPED** (cast). **P4 IN PROGRESS** (remove loose-fields shorthand). **RESERVED surface — no other agent touches:** (1) `src/Resource.ts` node/client typing (`NodeKey`, `AnyNode`, `AddressedNode`, `makeNode`, `connect*`, `clientLayer`, `socketClient`, `verifyConnection`, `protocolHttp`) + `NodeStatus` wiring; (2) the **payload/input schema-config** of `QueueResource.Tag` / `RunResource.Tag` / `Process.Tag` (P4). **Agent D must not touch queue/run/process payload-config until P4 merges.** Breaking OK.

### Active (owner approval required)
1. **Agent 1:** Examples book (`cursor/docs-corpus-phase3-ce05`) — hub in sidebar; Twoslash-paired `docs/examples/**` not in sidebar; forms first. Agent B: content glob + exclude example docs from More. Legacy Phase 3 leftovers background. Ignore effect β98 (Agent C).
2. **Agent 3:** Soft stack **idle** — [#62](https://github.com/NikScripts/effect-pm/pull/62)/[#65](https://github.com/NikScripts/effect-pm/pull/65) on `integration`. Next only if owner unlocks fail-loud Soft / memo (not handles/site).
3. **Agent D (+ peers):** named handles — do not reassign to Agent 3.

### Ready / owner calls
4. Store-layer `(scopeKey, lineId)` memo — **deferred**
5. Fail-loud Soft when AppStore lacks engine registration — **parked** (Agent 3 out of scope unless unlocked)
6. `main` merge + `pnpm run version` — still deferred

### Done prior (Agent 3)
- [#62](https://github.com/NikScripts/effect-pm/pull/62) Soft bake+override (`withDefaultStorage`) — **merged**
- [#65](https://github.com/NikScripts/effect-pm/pull/65) cutover follow-through (CustomQueue Soft + Soft prose) — **merged**
- [#59](https://github.com/NikScripts/effect-pm/pull/59) `byResource` full key + kill resource-identity `processId`/`queueId`
- [#57](https://github.com/NikScripts/effect-pm/pull/57) private `_logs`
- Process.events [#47](https://github.com/NikScripts/effect-pm/pull/47)/[#51](https://github.com/NikScripts/effect-pm/pull/51) · lineage [#48](https://github.com/NikScripts/effect-pm/pull/48) · ready-perfection [#52](https://github.com/NikScripts/effect-pm/pull/52)

### Deferred / parked
- **ShardMap author (Cursor):** type-safety + corpus sweep **merged** to `integration` (`f269a9ce`; was [#39](https://github.com/NikScripts/effect-pm/pull/39) / [#41](https://github.com/NikScripts/effect-pm/pull/41)). Branches deleted. Corpus-complete for Agent C remit.
- Headlining resource research — **shipped** as Telemetry fleet + ShardMap (#32/#39/#41); Agent 1 moved to docs corpus
- Agent B dashboard type-safety (plan-first) — **UI reserved for lettered agents**
- Agent C standards audit (plan-first)

### Branch hygiene (2026-07-14)
Deleted 32 remotes fully contained in `integration` or abandoned closed-PR tips. DynamicConfig on `integration` (#42); still `0.8.0-beta.28`, changeset unconsumed.

**Agent 3 Soft:** [#62](https://github.com/NikScripts/effect-pm/pull/62)/[#65](https://github.com/NikScripts/effect-pm/pull/65) on `integration`; follow-through brief **CLOSED**. Next Soft Eng only if owner unlocks fail-loud / outer-merge guard / memo.

---

## Completed

- [#65](https://github.com/NikScripts/effect-pm/pull/65) Soft cutover follow-through (CustomQueue Soft + Soft prose)
- [#62](https://github.com/NikScripts/effect-pm/pull/62) Soft bake+override Memory (`withDefaultStorage`)
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
