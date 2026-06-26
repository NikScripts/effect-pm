# Handoff: CustomQueueResource (weighted middle scheduling)

Diversify the queue's middle priority into many weighted numeric/named groups, pulled by a
non-starving scheduler — fixing strict-priority starvation. Ships as a **separate** resource type so
the default `QueueResource` is untouched and carries none of the new code.

**Design spec (read first):** `docs/plans/weighted-middle-scheduling.md`.
**Branch:** `rewrite/resource-toolkit` (everything below is committed there, not on main).

## Locked decisions
- **Number = weight** (weighted fair queuing): higher number → proportionally more service, no
  starvation. Equal weights ⇒ round-robin.
- **Algorithms:** `weighted` (default; virtual-time WFQ — the take-one analog of DRR) + `strict`
  (highest group first, opt-in, can starve). No others.
- **Bare `add(item)`** → a **configurable default group** (config `defaultPriority`, default a middle
  weight) so bare add works out of the box.
- **Separate type** `CustomQueueResource` — not a flag on `QueueResource`. Share the engine, swap the
  lane store (dependency injection), so neither bundle pulls the other's lane impl.

## Done (foundation — engine reuse is solved)
- **`src/internal/laneStore.ts`** — the `LaneStore` interface (`offer` / `poll` / `isEmpty` /
  `sizes` / `drain` / `extractMatching`) + `Lane` (`"high" | "low" | { group: number }`) +
  `LaneSizes`. The *only* lane-specific surface; the engine imports it **type-only**.
- **`src/internal/fifoLaneStore.ts`** — the classic strict high/normal/low (bounded Effect Queues),
  extracted behind the seam. Tests: `test/fifo-lane-store.test.ts`.
- **`src/internal/weightedLaneStore.ts`** — the weighted impl (the scheduler core): `Tx*`
  transactional lanes (`TxRef` arrays + `TxHashMap` of groups + a `TxRef` scheduler state),
  virtual-time WFQ + strict, `extractMatching`. Tests: `test/weighted-lane-store.test.ts` (strict
  order, weighted proportionality + no-starvation, sizes, extract, drain).
- **`src/QueueResource.ts`** — the engine is routed through the `LaneStore` (zero behavior change,
  116/116 queue tests) **and** injection-ready: `makeQueueRuntime` takes a lane-store factory
  `(capacity) => Effect<LaneStore<InternalItem<T>>>`. The default passes `makeFifoLaneStore`.
  Verified: `dist/QueueResource.js` pulls zero weighted/`Tx*` code.

## Remaining (the actual feature)
1. **Numeric/named priority surface — the one rippling piece.** The engine threads
   `priority: "high" | "normal" | "low"` (`Priority`) through **events** (`QueueEvent`),
   **persistence** (`DurableQueueStore` `priority_rank`), and **entries** (`QueueEntry.priority`).
   Supporting arbitrary `number | name` means widening that path. Suggested: introduce a `Lane`-based
   internal priority and keep `Priority` as the FIFO entry's public mapping; the weighted entry maps
   `number`/named → `{ group: n }`. `laneOf` already converts `Priority → Lane`; the inverse + the
   wire/persist representation of a numeric group is the work.
2. **`CustomQueueResource` contract/Tag + `layer` / `serveHttp`** wiring the weighted factory.
   `makeQueueRuntime` is currently `const` (internal) — export it (or a thin builder) so a new module
   can build the engine with `(capacity) => makeWeightedLaneStore({ kind })`. New module imports the
   weighted store; the engine imports neither.
3. **Named levels + `.configure`** — a registry `name → { priority: number }`, overridable per env
   via the existing config-patch layer; `add(item, "name")` resolves at enqueue.
4. **P2:** durable numeric priority (`priority_rank` is already numeric — small) + optional
   scheduler-state persistence (skip for v1; deficits re-converge fast). **P3:** per-group
   `sizes`/`metrics` + a dashboard widget (with the UI agent).

## Gotchas (learned the hard way)
- **`Effect.tx` + `Effect.txRetry` blocking does NOT reliably wake in effect@4.0.0-beta.69** (an
  isolated probe hung). That's why the store is **poll-based** and the engine owns the worker
  wake/blocking (a `Deferred`, entangled with shutdown + drain detection). Don't try to make the
  store block on `txRetry`.
- **Timing tests need `it.live`** (real clock) — `it.effect` uses a TestClock, so `Effect.sleep`/
  `delay` never elapse and the test hangs.
- **Effect v4 renames:** `Effect.fork`→`forkChild`, `Effect.transaction`→`Effect.tx`; `Fiber.poll`
  is gone. The deterministic-keys lint requires test service tags be id'd
  `@nikscripts/effect-pm/test/<file>/<Class>`.
- **Tree-shaking note:** the physical core-module split (so `CustomQueueResource` doesn't pull the
  ~110-line FIFO impl) is **deferred** — low marginal weight vs a high-risk 2,130-line move; pairs
  with roadmap plan 18. The important asymmetry (default never pulls weighted/`Tx*`) already holds.

## Gate
`./node_modules/.bin/tsgo --noEmit -p tsconfig.json` && `... -p tsconfig.src.strict-effect-provide.json`
(both 0), `pnpm lint`, `pnpm build`, `pnpm test` (pre-existing prisma harness failure is
environmental, not a regression).
