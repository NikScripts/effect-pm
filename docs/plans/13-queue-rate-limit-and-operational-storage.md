# 13 — Queue `rateLimit`, operational storage, and `ResourceConfigure` parity

**Status:** Agreed design (conversation May 2026). Implementation **paused** until
plan **12** identity discussion completes for anything that shares lease/storage
semantics. Queue rate limit itself can proceed after owner green-light.

**Branch archaeology:** `cursor/restore-queue-throttle-158c` was reset to
`402e733`; prior commits (`a2cb4bc`, `88bda84`, `4ddf35c`) explored throttle →
`rateLimit` — use as reference only, not source of truth.

**Related:** [STORAGE.md](../STORAGE.md),
[12-runtime-identity-and-singleton-runs.md](./12-runtime-identity-and-singleton-runs.md),
[resource-configure.md](../guides/resource-configure.md).

---

## Storage vision (one config for everything)

Apps compose **one** `ProcessStorage` / `RuntimeStorage` stack for:

| Kind | Examples | API today | Gap |
|------|----------|-----------|-----|
| **Facts / audit** | `queue.entry.*`, `process.execution.*`, `queue.ratelimit.exceeded` | Facet `create` + reads | — |
| **Operational state** | Rate-limit counters per key, instance leases (plan 12) | Spine `upsert` / `update` | Facet helpers (`ProcessStore.state` / mutate DSL), **`transaction`** |
| **Analytics** | Dashboard projections | Reads | [04-queue-analytics.md](./04-queue-analytics.md) |

**Not** append-only-only storage. **Not** a separate in-memory Effect store as
the primary enforcement path for limits or leases.

Adapters: **SQLite** and **Prisma** are **valid for high volume** when using
**one state row per hot key**, **transactional** read-modify-write, and indexes.
**Redis** is an **optional** later adapter behind the same store interface for
multi-host contention — **not required**.

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
| Enforcement store | **`RateLimiterStore`** on **`RuntimeStorage`**: upsert state row per limit key, transactional consume |

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

## `RateLimiterStore` (planned)

- Layer composed from **`layerProcessStore`** / `ProcessStorage.layerRuntimeStorage`.
- One **state** row per `(queueId, rateLimitKey)` (or global key per queue).
- `consume` = transaction: read counter window → decide → write → commit.
- Facet optional: emit **`queue.ratelimit.exceeded`** on reject (audit only).
- **Redis adapter (optional):** same interface, later slice.

---

## Redis — integration options (design note)

Effect v4 persistence already splits concerns:

| Effect module | Backing | Role |
|---------------|---------|------|
| `Persistence` + `layerRedis` | Redis KV + Lua | Generic key-value persistence |
| `RateLimiter` + `layerStoreRedis` | `RateLimiterStore` on `Redis.Redis` | Hot counter / token-bucket only |
| `PersistedQueue` + `layerStoreRedis` | Redis lists/hashes | Durable work queue (not PM `QueueResource`) |

**Recommended for effect-pm (hybrid, not “Redis for all storage”):**

```text
ProcessStorage.layerRuntimeStorage
  └─ RuntimeStorage  →  SQLite or Prisma (source of truth)
        ├─ facets: facts, audit, instance leases, rate-limit state rows
        └─ optional: RateLimiterStore adapter
              ├─ default: rows + transaction on same RuntimeStorage
              └─ scale-out: delegate consume to Effect layerStoreRedis
                    (provide Redis.Redis from app; prefix per queue/app)
```

- **Do not** replace `RuntimeStorage` with Redis for the full facet row model
  unless there is a dedicated ADR: you lose unified SQL/Prisma queries,
  dashboard projections, and the single-table ops story.
- **Do** use Redis when **cross-host writers** contend on the same limit keys or
  leases and SQLite/Prisma row locking is too hot — same **logical**
  `RateLimiterStore` / lease API, different adapter.
- **Could** use Effect `Persistence.layerRedis` only for a narrow internal
  bridge (e.g. lease cache) — still hybrid; primary history stays in
  `effect_pm_runtime_records`.

A future `layerProcessStoreRedis` would be a **second** durable adapter implementing
`RuntimeStorageService`, not a bolt-on beside Prisma — large scope; not plan 13 v1.

---

## Docs to update when shipped

| Doc | Change |
|-----|--------|
| [guides/queue-resource.md](../guides/queue-resource.md) | Document `rateLimit`; remove “not queue throttle” caveat |
| [STORAGE.md](../STORAGE.md) | Wire table + state/audit semantics |
| [CODEBASE-INVENTORY.md](../CODEBASE-INVENTORY.md) | Queue throttle row |
| `src/QueueResource.ts` module TSDoc | `rateLimit` + order vs semaphore |

---

## Implementation slices (after green-light)

1. `RuntimeStorage.transaction` + tests (memory, sqlite, prisma).
2. `RateLimiterStore` + facet/state row type + transactional consume.
3. `QueueResource` `rateLimit` + configure + worker wiring + tests.
4. `queue.ratelimit.exceeded` encoder/decoder in `src/store/queueResource.ts`.
5. Guide + STORAGE wire row + **changeset** (user approval).

**Do not** reintroduce `throttle` alias or in-memory-only primary store.

---

## Verification

```sh
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

---

## Explicit non-goals (this plan)

- Using historical `runId` queries to detect concurrent duplicate processes
  (see plan **12** — active lease instead).
- Requiring Redis for rate limiting.
- Shipping rate limit before transaction API exists (unless memory-only dev mode
  is explicitly approved as a temporary slice).
