# Handoff: CustomQueueResource (N-level priority + take algorithm)

**Branch:** `rewrite/resource-toolkit`.

## Done (approved design — implemented)

- **`LaneStore`** — numeric levels (`offer(item, level)`), `sizes: number[]`, opaque `poll`.
- **`levelLaneStorePriority`** — default path (`takeAlgorithm: "priority"`); Effect `Queue` only.
- **`levelLaneStoreScheduled`** — `weighted`, `strict-descending`, custom pick; dynamic import only.
- **`QueueResourceConfigBase`** — `levelCount?`, `takeAlgorithm?` (built-in or {@link CustomTakeAlgorithm}).
- **`buildQueueEngine`** — extension point in `QueueResource.ts` for `CustomQueueResource`.
- Default queue: 3 levels, `{ high, normal, low }` public surface unchanged.

## Remaining

1. **`CustomQueueResource` Tag + contract** — `levelCount`, named levels, `sizes: Record<string, number>`.
2. **Numeric/named `add`** — widen enqueue/events/persistence beyond `Priority`.
3. **Named level registry + `.configure`**.

## Bundle rule

Default `QueueResource` import graph must not statically import `levelLaneStoreScheduled`.

## Gate

`pnpm run typecheck`, `pnpm test`, `pnpm build`.
