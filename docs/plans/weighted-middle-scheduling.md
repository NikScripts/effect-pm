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

## Packaging — a separate resource type, not a change to every queue

Ship this as its own hyperlink type (`WorkPool.define` (untyped), name TBD), **not** as a feature added to
the standard `WorkPool`. This is the key decision that de-risks the whole thing:

- The existing `WorkPool` and everything on it (wow, the dashboard) are **untouched** — no wire-
  schema churn under live consumers. The new type carries its own (per-group) schema from day one.
- The default queue stays lean + tree-shakeable: queues that don't weight never pull the STM
  scheduler code (mirrors how the `WorkPool` namespace already splits the light `Tag` from the
  engine).
- No back-compat gymnastics (no "additive sizes" hack, no preserving `{high,normal,low}` alongside
  groups).

**Share the engine, swap only the lane store.** Factor a small internal `LaneStore` interface
(`offer` / `take` / `sizes` / `drain`); the default wires the 3-FIFO impl, `WorkPool.define` (untyped)
wires the weighted-STM impl. Worker pool, retries, metrics/logs/history, persistence plumbing, and
lifecycle are shared (written once); only the data structure + scheduler differ — and only the new
type imports the STM impl.

## Engine change — a custom STM structure (the weighted `LaneStore`)

Today: `highQueue` / `normalQueue` / `lowQueue` are bounded Effect `Queue`s, pulled strictly via
`queueForPriority`. Replace with **one STM structure**:

- `high` / `low` → `TQueue` (strict), middle → `TMap<number, TQueue<item>>`, scheduler state → `TRef`.
- `take` = **one STM transaction**: `high` → else `scheduler.pick(middle)` → else `low` → else
  `STM.retry`.
- `STM.retry` provides blocking-take + wakeups + atomic multi-worker takes for free — this **removes**
  the current `workerWakeSignal` / feeder-coordination machinery rather than adding to it.
- Bounded backpressure preserved via bounded `TQueue` (retry-on-full).

Scope: a self-contained STM scheduler module + rewiring the worker take path in `WorkPool.ts`.

## Ripple effects (the real cost is downstream)

1. **Wire schema + dashboard:** because it's a **separate type**, the existing `WorkPool` and
   dashboard are untouched — there's no migration of the current schema. The new type defines its own
   per-group `sizes` / `status` / `metrics` and `add(item, number | name)`; the UI agent adds a
   widget for it **when ready**, on its own timeline (additive, not a forced change).
2. **Persistence:** `DurableWorkPoolStore.priority_rank` is already numeric, so storing arbitrary
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
