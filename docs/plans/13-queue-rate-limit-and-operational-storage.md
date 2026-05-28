# 13 — Queue `rateLimit`, operational storage, and `ResourceConfigure` parity

**Status:** Agreed design (conversation May 2026). Slice order is **owner-defined**.
Identity (plan 12) and rate limit share `RuntimeStorage.transaction` and adapter work.

**Branch archaeology:** `cursor/restore-queue-throttle-158c` was reset to
`402e733`; prior commits (`a2cb4bc`, `88bda84`, `4ddf35c`) explored throttle →
`rateLimit` — use as reference only, not source of truth.

**Related:** [STORAGE.md](../STORAGE.md),
[12-runtime-identity-and-singleton-runs.md](./12-runtime-identity-and-singleton-runs.md),
[resource-configure.md](../guides/resource-configure.md).

---

## Storage vision — `RuntimeStorage` is all storage

**Rule (owner):** There is **one** storage surface in effect-pm: **`RuntimeStorage`**.
Every facet read/write goes through the spine → **`RuntimeStorage`**. No parallel
persistence stack beside it (no “also wire Effect `layerStoreRedis` at the app root”).

**How you compose layers (not “always all facets”):**

1. **Durable backend** — provide exactly one `RuntimeStorage` adapter, e.g.
   `Layer.provideMerge(ProcessStorage.layerRuntimeStorage, layerProcessStore({…}))`
   or Prisma equivalent.
2. **Facets** — either:
   - **`ProcessStorage.layerRuntimeStorage`** — all built-in facets at once, or
   - **Individual** `ProcessStoreQueueResource.layerRuntimeStorage` (etc.) merged
     with only the facets you use — each still requires **`RuntimeStorage`** in context.

`ProcessStorage.layer` = facets + in-memory `RuntimeStorage` (tests/dev only).

| Kind | Examples | Through |
|------|----------|---------|
| Facts / audit | `queue.entry.*`, `process.execution.*`, `queue.ratelimit.exceeded` | Facet → spine → `RuntimeStorage` |
| Operational state | Rate-limit counters, instance leases (plan 12) | Same |
| Analytics reads | Dashboard projections | Same |

**Hybrid** means **one `RuntimeStorage` implementation** that **routes internally**
to more than one durable backend — not “SQL for history + a separate Redis
rate limiter service the app composes on its own.”

```text
Your program
  └─ Layer.provideMerge(
        ProcessStorage.layerRuntimeStorage   // or subset of facet layers
        layerRuntimeStorageX,                // ONE adapter below
     )
        └─ RuntimeStorage   ← ONLY storage service
              └─ adapter implementation:
                    · memory | sqlite | prisma | redis | hybrid
```

**Adapter shapes (all implement `RuntimeStorageService`):**

| Layer export (names TBD) | Meaning |
|--------------------------|---------|
| `layerRuntimeStorageSqlite` / Prisma | Today’s SQL path |
| `layerRuntimeStorageRedis` | **All** row operations on Redis |
| `layerRuntimeStorageHybrid` | **One** service: e.g. SQL for bulk/history, Redis for hot keys (leases, rate windows), unified `transaction` semantics across both |

Effect `effect/persistence/Redis`, `RateLimiter` Lua scripts, etc. are **implementation
details inside** a `RuntimeStorage` adapter — not a second public compose point.

### Agent recommendation (storage backend)

| Option | Recommend when |
|--------|----------------|
| **Hybrid `RuntimeStorage`** (SQL + Redis **inside one adapter**) | **Default for production** once cross-host leases and `rateLimit` ship: SQL/Prisma for facet rows, history, and dashboard-style reads; Redis inside the same adapter for lease + rate-limit hot keys and multi-writer atomicity. |
| **SQL / Prisma only** | Single-node or dev until hybrid adapter exists; acceptable when all singleton enforcement is in-process only. |
| **Redis-only `RuntimeStorage`** | You standardize on Redis as the only durable infra and accept modeling/query tradeoffs for full history in Redis — valid, not the default recommendation for this package. |

**Not recommended:** SQL `RuntimeStorage` at the app layer **plus** a separate Effect `RateLimiter.layerStoreRedis` compose — that violates “`RuntimeStorage` is all storage.”

**Summary:** implement **`layerRuntimeStorageHybrid`** as the target production path;
keep sqlite/prisma as today; add redis-only if you want a single-infra deployment option.

---

## `RuntimeStorage.transaction` (prerequisite)

- Error channel already mentions `transaction` (`RuntimeStorageError`).
- **No `transaction()` method** on the service yet — must land in memory,
  SQLite, and Prisma adapters before durable `RateLimiterStore` or instance
  leases (plan 12).

---

## Queue `rateLimit` — public API (agreed)

### Naming

- Field: **`rateLimit`** only.
- **No** legacy **`throttle`**.
- **No** separate **`duration`** field — use Effect `RateLimiter.consume` shape.

### Types

```ts
type QueueResourceRateLimitOptions =
  Omit<Parameters<RateLimiter["consume"]>[0], "key"> & {
    readonly key?: string;
    readonly record?: "exceeded" | "off";
  };
```

- Integrate via **`QueueResource.configure`** / `ResourceConfigure` like
  `concurrency` (linked partial patches, `foldConfig` at layer acquisition).

### Runtime behavior

| Topic | Decision |
|-------|----------|
| Implementation | Effect **`RateLimiter`** (`makeWithRateLimiter` or equivalent) |
| Default `onExceeded` | **`"delay"`** for queues (Effect default is **`"fail"`** if omitted) |
| Order in worker | **Rate limit before** concurrency semaphore |
| Hook | Optional **`onRateLimitExceeded`** |
| Audit | Wire **`queue.ratelimit.exceeded`** on `ProcessStoreQueueResource` when `record: "exceeded"` (default); `record: "off"` skips facet write |
| Enforcement store | Consume path calls **`RuntimeStorage`** only (state row or Redis route inside hybrid adapter); Effect `RateLimiter` math/Lua **inside** adapter if needed |

### Configure / Service extension (do not forget)

Apply the same **config + `Service` class** pattern used by `QueueResource` to:

- **`Process.Service`** — hooks, future lease options.
- **`RunResource`** — Effect scout suggested `RateLimiter` path; align options shape.
- **`HttpApiResource`** — concurrency/throttle gates; ensure `.configure` parity.
- Any new resource modules — **must** use `configureLayer` / `ConfigPatch`, not
  one-off env toggles.

Reference: [resource-configure.md](../guides/resource-configure.md),
`src/ResourceConfigure.ts`.

---

## Rate limit enforcement (planned)

- `QueueResource` worker calls **`RuntimeStorage`** (via internal store helper) for
  consume / state — same as leases.
- One logical state key per `(queueId, rateLimitKey)` (or per-queue default).
- `RuntimeStorage.transaction` (or hybrid equivalent) for atomic consume.
- Facet emits **`queue.ratelimit.exceeded`** on reject when `record: "exceeded"`.
- If the active adapter is **hybrid** or **redis**, hot keys live on Redis **inside**
  that adapter; the app still provides only `layerRuntimeStorage(…)`.

---

## Redis — one storage model, multiple adapters

| Deployment | App composes | What happens |
|------------|--------------|--------------|
| SQL only | `layerProcessStore` / Prisma | All rows in SQL |
| Redis only | `layerRuntimeStorageRedis` (TBD) | All rows/keys via Redis |
| Hybrid | `layerRuntimeStorageHybrid` (TBD) | **Single** `RuntimeStorage`; adapter routes by policy (e.g. state → Redis, facts → SQL) |

**Not acceptable:** Prisma `RuntimeStorage` for facets **plus** `RateLimiter.layerStoreRedis`
at the app layer — that is two stores, not hybrid `RuntimeStorage`.

Effect persistence modules (`Redis`, `RateLimiter` Lua, `Persistence.layerRedis`) may be
**used inside** `src/storage/redis/` or `src/storage/hybrid/` — they are not alternate
public entrypoints for apps.

---

## Docs to update when shipped

| Doc | Change |
|-----|--------|
| [guides/queue-resource.md](../guides/queue-resource.md) | Document `rateLimit`; remove “not queue throttle” caveat |
| [STORAGE.md](../STORAGE.md) | Wire table + state/audit semantics |
| [CODEBASE-INVENTORY.md](../CODEBASE-INVENTORY.md) | Queue throttle row |
| `src/QueueResource.ts` module TSDoc | `rateLimit` + order vs semaphore |

---

## Implementation slices (order: owner)

1. `RuntimeStorage.transaction` + tests (memory, sqlite, prisma, then redis/hybrid).
2. Adapter(s): redis-only and/or hybrid `RuntimeStorageService` if in scope.
3. Internal consume helper on `RuntimeStorage` for rate limits (+ plan 12 leases).
4. `QueueResource` `rateLimit` + configure + worker wiring + tests.
5. `queue.ratelimit.exceeded` in `src/store/queueResource.ts`.
6. Guides + STORAGE + changeset when releasing.

**Do not** reintroduce `throttle` or a second app-level Effect rate-limit layer.

---

## Verification

```sh
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

---

## Anti-patterns

- Second storage compose path (Effect `layerStoreRedis` at app root while SQL
  `RuntimeStorage` handles facets).
- Using historical `runId` queries for singleton enforcement (plan **12** — lease
  state on `RuntimeStorage`).
