# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration branch:** **`integration`** (formerly `integration/storage`). Type-display cleanup + `Client<T>` override + `Kind` drop + logs Phase 5 + ProcessStorage retirement + `NodeLogs` removal all folded. See [`whats-changed-2026-07-13.md`](./whats-changed-2026-07-13.md).

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | from `integration` | [next headlining resource](./agent-01-next-headlining-resource.md) · [#32 prototype](https://github.com/NikScripts/effect-pm/pull/32) | **plan-first** | — | — | Research / Telemetry+ShardMap prototype — owner picks; **no impl until then** | 2026-07-14 |
| **2** | merged via [#33](https://github.com/NikScripts/effect-pm/pull/33) | [logs plan](./agent-02-logs-platform-plan.md) | **retired / merged** | `integration` tip | green | Phase 5 + `NodeLogs` closeout done; P1 handed to Agent 3 | 2026-07-14 |
| **3** | from `integration` | [Logs P1](./agent-03-logs-p1.md) | **plan-first** | — | — | Level pipes / store followers / remote logs — owner unlocks slices | 2026-07-14 |
| **B** | merged / brief | [dashboard typesafety](./agent-b-dashboard-typesafety.md) | **plan-first** | on line | — | Owner-gated | 2026-07-13 |
| **A** | merged | [rules/docs](./agent-a-rules-and-documentation.md) | **merged** | on line | — | — | 2026-07-12 |
| **C** | `chore/standards-audit` | [standards audit](./agent-c-standards-audit.md) | **plan-first** | on line | manifest ✓ | Owner-gated | 2026-07-13 |
| **D** | `feat/named-handles` from `integration` | [named handles](./agent-d-named-handles.md) · [convergence decisions](./queue-handle-convergence-decisions.md) | **design locked / pre-impl** | `34095ea1d` | — | Scope grew: `Tag ≡ Service` convergence (owner-set invariant), not additive-only. Decisions doc pushed; impl awaits owner go. Agent 3 must not touch handles | 2026-07-13 |

---

## Supervisor queue

### Active (owner approval required)
1. **Agent 3:** [`agent-03-logs-p1.md`](./agent-03-logs-p1.md) — expand Logs platform P1 (levels / followers / remote). **Plan first.**
2. **Agent 1:** next headlining resource research / [#32](https://github.com/NikScripts/effect-pm/pull/32) prototype — owner picks direction.
3. **Agent D (+ peers):** named handles — do not reassign to Agent 3.

### Ready / owner calls
4. Logs P1 slice unlock (after Agent 3 plan) — `A` / `B1|B2|B3` / `C1|C2|C3`
5. `main` merge + `pnpm run version` — still deferred
6. Process live `events` (#20) — needs failure-surface decision

### Deferred / parked
- Agent B dashboard type-safety (plan-first)
- Agent C standards audit (plan-first)
- `Store.layerQuery` (not approved)
- Headlining resource **implementation** (after Agent 1 + owner pick)

---

## Completed

- [#33](https://github.com/NikScripts/effect-pm/pull/33) Logs closeout — `NodeLogs` shim removed; Agent 2 retired
- [#30](https://github.com/NikScripts/effect-pm/pull/30) Phase 5 Logs — `captureLogs` / handle `logs` removed
- ProcessStorage / RuntimeStorage / ProcessLifecycleStore facet substrate **retired**
- [#26](https://github.com/NikScripts/effect-pm/pull/26) Process `run` RPC + effect/effectFn
- [#23–#25](https://github.com/NikScripts/effect-pm/pull/23) queue ref + node status + tag schemas

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`.
