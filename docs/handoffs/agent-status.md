# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration branch:** **`integration`** (formerly `integration/storage`). Type-display cleanup + `Client<T>` override + `Kind` drop + logs Phase 5 + ProcessStorage retirement + `NodeLogs` removal all folded. See [`whats-changed-2026-07-13.md`](archive/2026-07/features/whats-changed-2026-07-13.md).

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **4** | `cursor/hyperservice-open-deps-5679` | [service shapes plan](../plans/service-shapes.md) | **Eng’d** — tip-synced | `5c4baa99` (= `integration`) | typecheck + tag-iface/value-plain suites | Next: `Hyperlink.promise`, then `pure` | 2026-07-26 |
| **G / TUI** | `cursor/tui-dashboard-parity-125f` | TUI ↔ web Dashboard Group parity | **design** — client adapters notes; tip-synced | same tip as `integration` | prior suites green | Notes: [`client-adapters-design.md`](./client-adapters-design.md) — Promise / TanStack / tRPC-shape / Effect-reactive helpers; Eng TBD | 2026-07-24 |
| **1** | `cursor/docs-corpus-phase3-ce05` | [Examples book](./agent-01-examples-book.md) · [Phase 3](./agent-01-docs-corpus-phase3-plan.md) | **E1 in flight** — Examples hub + queue Twoslash pairs | branch tip | hub + 2 queue docs | **Next:** E2 forms/resource pairs | 2026-07-15 |
| **2** | merged via [#33](https://github.com/NikScripts/effect-pm/pull/33) | [logs plan](archive/2026-07/agents/agent-02-logs-platform-plan.md) | **retired / merged** | `integration` tip | green | Phase 5 + `NodeLogs` closeout done; P1 handed to Agent 3 | 2026-07-14 |
| **3** | `cursor/logs-store-followers-plan-906e` | [identity-coordinator](./identity-coordinator.md) · [loud-failures](./loud-failures-design.md) | **idle** — Soft / default-on verify / F4 / lineId memo Eng’d | same tip as `integration` | typecheck + targeted suites green | Ready for next major | 2026-07-21 |
| **B** | from `integration` | [dashboard typesafety](./agent-b-dashboard-typesafety.md) | **plan-first** | on line | — | Owner-gated; remote `fix/dashboard-typesafety` tip was already on line (deleted) | 2026-07-14 |
| **A** | merged | [rules/docs](archive/2026-07/agents/agent-a-rules-and-documentation.md) | **merged** | on line | — | — | 2026-07-12 |
| **C** | from `integration` | [standards audit](./agent-c-standards-audit.md) | **plan-first** | on line | manifest ✓ | Owner-gated; remote `chore/standards-audit` tip was already on line (deleted) | 2026-07-14 |
| **D** | **merged to `integration`** | [named handles](./agent-d-named-handles.md) · [convergence decisions](./queue-handle-convergence-decisions.md) | **M3 shipped** | `d2d340b4b` | typecheck 0 (both) / lint 0 / 418 tests | **M3 done:** `yield* MyQueue` hovers as named `QueueResource<Item>` (Svc seam on ResourceTag + 1 harness-guarded cast in nameQueueService; `events` success now `void`). Follow-ups: M2 `.Service` unify, per-Tag success/error carriers, elide trailing default args. Agent 3 must not touch handles | 2026-07-14 |
| **E** | folded into Agent 3 work branch | [impossible-states](./impossible-states-proposal.md) · [loud-failures](./loud-failures-design.md) | **merged to tip** | `integration` | F1–F4 + default-on verify Eng’d | — | 2026-07-21 |

---

## Supervisor queue

### Reserved — hands off (2026-07-16, owner-assigned)
0. **Agent E:** impossible-states plan ([`impossible-states-proposal.md`](./impossible-states-proposal.md)). **DONE + merged:** P1 (node↔protocol wiring bug → compile error, cast-free) + P5 (http transport dies in browser). **P2 SKIPPED** (cast). **P4 already-enforced** (loose-fields payload already rejected; proposal mis-scoped). **P3 deferred** (opaque serve layers). Clean wins complete. Reserved `src/Resource.ts` node/client surface until fully merged (done). **Tag-config reservation RELEASED — Agent D queue/run/process payload-config unblocked.**

### Active (owner approval required)
1. **Agent 4:** Service shapes — Eng’d `Tag<Self, I>()` (kill `fromService`) + `constant`→`value` (fallible acquire). Next: `Hyperlink.promise`, then `pure`. Creating a Hyperlink polish still paused.
2. **Agent 1:** Examples book (`cursor/docs-corpus-phase3-ce05`) — hub in sidebar; Twoslash-paired `docs/examples/**` not in sidebar; forms first. Agent B: content glob + exclude example docs from More. Legacy Phase 3 leftovers background. Ignore effect β98 (Agent C).
3. **Agent 3:** **idle** — Soft fail-loud, default-on verify, F4 `contractHash`, store-layer lineId memo Eng’d (owner “All of them”). Not handles/site.
4. **Agent D (+ peers):** named handles — do not reassign to Agent 3.

### Ready / owner calls
5. **Node catalog + identity lookup** — design [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md); Phase-2–3 catalog/directory/**D3**/**D4**/**D7**/`Node.Prototype` Eng on tip; **`askIncumbent` Eng’d**; **X1 Eng’d**; **managers → [`identity-coordinator.md`](./identity-coordinator.md) M4–M6 Eng’d** (v1 complete)
6. Store-layer `(scopeKey, lineId)` memo — **Eng’d**
7. Fail-loud Soft when AppStore lacks engine registration — **Eng’d**
8. `main` merge + `pnpm run version` — still deferred

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
