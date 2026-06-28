# Handoff: CustomQueueResource (N-level priority + take algorithm)

**Branch:** `rewrite/resource-toolkit`.

## Done (approved design — implemented)

- **`LaneStore`** — numeric levels (`offer(item, level)`), `sizes: number[]`, opaque `poll`.
- **`levelLaneStorePriority`** — default path (`takeAlgorithm: "priority"`); Effect `Queue` only.
- **`levelLaneStoreScheduled`** — `weighted`, `strict-descending`, custom pick; dynamic import only.
- **`QueueResourceConfigBase`** — `levelCount?`, `takeAlgorithm?` (built-in or {@link CustomTakeAlgorithm}).
- **`buildQueueEngine`** — extension point in `QueueResource.ts` for `CustomQueueResource`.
- Default queue: 3 levels, `{ high, normal, low }` public surface unchanged.
- **`CustomQueueResource`** — engine `make`, `rateLimiterLayer`; `add(item, level?)`, `sizes: Record<string, number>`.
- **`CustomQueueContract`** — toolkit `Tag` / `layer` / `server` / `configure` (mirrors {@link QueueContract}).
- **Tag factory** — `(id, schema, levelCount, namedLevels?)` or `(id, schema, levelNames[])`.
- **`Resource.mutatePair`** — wire + service surface for `add(item, level?)`.
- **Docs / example** — `docs/RESOURCE-API.md`, `docs/guides/toolkit-by-example.md`, `examples/forms/queue/custom-queue-resource-n-level.ts`.

## Quick reference

```typescript
class Jobs extends CustomQueueResource.Tag<Jobs>()(
  "@app/Jobs",
  JobSchema,
  8,
  { urgent: 0, batch: 7 },
) {}

yield* queue.add(job, "urgent")
const sizes = yield* queue.sizes // { urgent: n, batch: m, "3": … }
```

Subpaths:

| Import | Carries |
|--------|---------|
| `@nikscripts/effect-pm/CustomQueueContract` | Tag, layer, server — no engine |
| `@nikscripts/effect-pm/CustomQueueResource` | Namespace + `make` engine |

## Remaining

1. **Named level registry + `.configure`** for per-environment level overrides.

## Bundle rule

Default `QueueResource` import graph must not statically import `levelLaneStoreScheduled`.

## Gate

```bash
pnpm run typecheck
pnpm test test/custom-queue-resource.test.ts test/custom-queue-contract.test.ts
pnpm test test/queue-resource.test.ts test/level-lane-store-*.test.ts
pnpm build
pnpm run example:custom-queue-resource
```
