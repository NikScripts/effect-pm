# Weighted middle scheduling (diversified priority)

**Status:** designed, not started. Fixes the core limitation of the current 3-level queue: strict
priority means a level is pulled **only** when all levels above are empty, so lower levels starve.

## Idea

Keep the two **strict** tiers, diversify the middle into many **weighted** groups:

- `high` = strict top (unchanged), `low` = strict bottom (unchanged).
- **middle** = arbitrarily many numeric groups. `add(item, n)` routes to group `n`; among non-empty
  middle groups a **scheduling algorithm** picks the next item — no strict starvation.
- The **number is the weight** (weighted fair queuing): a higher number gets proportionally more
  service, but lower groups never starve. Equal numbers ⇒ plain round-robin.
- **Named levels:** a registry `name → { priority: number, weight? }`; `add(item, "interactive")`
  resolves the name, and `.configure` overrides the number/weight per environment (rides the
  existing config-patch layer).
- Existing API preserved: `add` → a default middle group (`normal`), `prioritize` → `high`,
  `defer` → `low`.

## Algorithms (pluggable `scheduler.pick(nonEmptyGroups, state)`)

- **Deficit Round Robin (DRR)** — default. Weighted, provably no starvation; weight = the group's
  number. Equal weights degrade to fair round-robin (so no separate "fair" algorithm is needed).
- **Strict descending** — opt-in. Highest number first; *can* starve lower middle groups. Only for
  queues that genuinely want strict middle ordering.

(Weighted-random and standalone fair-RR were considered and dropped — DRR subsumes the useful cases.)

## Engine change — a custom STM structure (replaces the three `Queue.bounded`)

Today: `highQueue` / `normalQueue` / `lowQueue` are bounded Effect `Queue`s, pulled strictly via
`queueForPriority`. Replace with **one STM structure**:

- `high` / `low` → `TQueue` (strict), middle → `TMap<number, TQueue<item>>`, scheduler state → `TRef`.
- `take` = **one STM transaction**: `high` → else `scheduler.pick(middle)` → else `low` → else
  `STM.retry`.
- `STM.retry` provides blocking-take + wakeups + atomic multi-worker takes for free — this **removes**
  the current `workerWakeSignal` / feeder-coordination machinery rather than adding to it.
- Bounded backpressure preserved via bounded `TQueue` (retry-on-full).

Scope: a self-contained STM scheduler module + rewiring the worker take path in `QueueResource.ts`.

## Ripple effects (the real cost is downstream)

1. **Wire schema + dashboard (biggest):** `sizes` / `status` / `metrics` go from `{high,normal,low}`
   to per-group; `add`'s priority param gains `number | name`. Ripples into `QueueContract` schemas
   and the **UI agent's** dashboard — cross-agent coordination.
2. **Persistence:** `DurableQueueStore.priority_rank` is already numeric, so storing arbitrary
   numbers is small. Persisting **fairness state** (DRR deficits) across restart is the only extra —
   **skip in v1** (deficits re-converge in seconds).
3. **Back-compat:** `high` / `normal` / `low` and the existing `add` / `prioritize` / `defer` stay
   intact; `normal` becomes the default middle group.

## Phasing

- **P1 (core):** STM tiered scheduler + numeric/named `add` + DRR & strict-descending + `.configure`
  for named levels. In-memory; `sizes` extended additively. The real work.
- **P2:** durable numeric priority (+ optional fairness-state persistence).
- **P3:** per-group `sizes` / `metrics` + dashboard, with the UI agent.

## Open questions

- Exact wire shape for per-group `sizes` (e.g. `{ high, low, groups: Record<string, number> }`) —
  settle with the UI agent in P3.
- Whether `add(item)` (bare) stays mapped to a fixed `normal` group or to a configurable default.
