# 15 — Hybrid `RuntimeStorage` (design spec)

**Status:** Target production adapter (not shipped). See the roadmap entry in
[README.md](./README.md) (Persistence & storage). Builds on the shipped `RuntimeStorage` +
`src/store/*` facet model ([STORAGE.md](../STORAGE.md)).

---

## One sentence

**Hybrid is a single `RuntimeStorage` layer you choose at compose time** — its
implementation routes some operations to SQL and some to Redis **inside** the
adapter. It is **not** “always on” and **not** a second Redis stack beside SQL.

---

## Compose time — you pick ONE adapter

| Layer (export names TBD) | When |
|--------------------------|------|
| `RuntimeStorage.layer` | Memory — tests only |
| `layerProcessStore` (sqlite) | SQL only — today |
| `layerPrismaRuntimeStorage` | SQL only — today |
| `layerRuntimeStorageRedis` | **Redis only** — all rows/keys on Redis |
| `layerRuntimeStorageHybrid` | **SQL + Redis** — recommended production default once built |

```ts
// Hybrid production (facets: all or subset)
Layer.provideMerge(
  QueueResourceStore.layerRuntimeStorage,
  LogStore.layerRuntimeStorage,
  layerRuntimeStorageHybrid({
    sql: layerProcessStore({ filename: "…" }), // or Prisma
    redis: { send: redisClient.send },       // Effect Redis.Redis shape
    policy: defaultHybridPolicy,
  }),
);
```

Same as today: you may use `ProcessStorage.layerRuntimeStorage` instead of
merging individual `*.layerRuntimeStorage` facets.

**You do not** compose `layerProcessStore` **and** `RateLimiter.layerStoreRedis`
at the app root. That is two stores.

---

## Runtime — one service, internal router

```text
Facet static emitter / spine
  → RuntimeStorage.create | read | upsert | update | delete | transaction
        → HybridRuntimeStorage (single Context tag)
              ├─ SqlBackend   (existing sqlite/prisma row codec)
              └─ RedisBackend (keys + Lua for hot paths)
```

Facets **never** import Redis. They only see `ProcessStoreSpine` → `RuntimeStorage`.

---

## Routing policy (default proposal)

Classify by **`RuntimeRecord.type`** prefix and/or explicit **state** marker
(exact rules finalized when `instanceId` columns land).

| Traffic | Backend | Examples |
|---------|---------|----------|
| **Cold / historical** | SQL | `queue.entry.*`, `process.execution.*`, `log.entry`, `process.lifecycle.*` |
| **Hot / coordination** | Redis | Instance lease rows, rate-limit window state, optional dedupe active-set |
| **Audit on reject** | SQL (default) | `queue.ratelimit.exceeded` — dashboard-friendly |

**Redis key layout (illustrative):**

```text
effect-pm:{namespace}:lease:{logicalProcessId}     → holder, instanceId, expiresAt
effect-pm:{namespace}:ratelimit:{queueId}:{key}  → fixed-window / token-bucket blob
```

**SQL** keeps `effect_pm_runtime_records` (or Prisma model) as today for
anything you want to query with `RuntimeRecordQuery` / facets.

Policy object (hybrid config) lets apps override:

```ts
type HybridPolicy = {
  readonly route: (record: Omit<RuntimeRecord, "runId" | "createdAt">) => "sql" | "redis";
  readonly leaseTypes: ReadonlySet<string>;
  readonly stateTypes: ReadonlySet<string>;
};
```

---

## `transaction` across hybrid

**Requirement:** `RuntimeStorage.transaction(effect)` is the public API.

**Semantics (v1 proposal):**

1. **SQL-only transaction** — when `effect` only touches SQL-routed types, delegate
   to SQL `BEGIN` / `COMMIT`.
2. **Redis-only** — Lua script or `MULTI` for lease acquire + rate consume when
   all touched keys are Redis.
3. **Mixed** — **avoid in v1**; document as unsupported or use **outbox** pattern
   later (write intent SQL + Redis in ordered steps with compensating actions).

**Lease acquire (cross-host singleton):**

```text
transaction {
  Redis SET lease key NX + TTL   // fail → DuplicateInstanceError
  SQL insert lifecycle fact      // optional audit row same transaction boundary
}
```

If mixed atomicity is required, v1 can **audit on SQL after** successful Redis NX
(best-effort) with owner-approved “log error” when SQL fails after Redis success
(reconcile job later).

---

## Effect Redis / RateLimiter inside the adapter

`src/storage/hybrid/` (and `src/storage/redis/`) may call:

- `effect/persistence/Redis` — `Redis.make({ send })`
- `RateLimiter` Lua scripts — **copied or imported** for `consume` math on Redis keys

Those are **private implementation** of `RuntimeStorageService`, not layers the
app provides.

**SQL path** for rate limits (until hybrid ships): same `consume` logic in
`transaction` + `upsert` on a state row in sqlite/prisma.

---

## Redis-only adapter (non-hybrid)

`layerRuntimeStorageRedis` implements **the same** `RuntimeStorageService` interface:

- All `create` / `read` / `upsert` map to Redis structures (hash per record id or
  secondary indexes via key sets).
- Facets unchanged.
- Tradeoff: you implement indexing/query parity or accept narrower reads until
  projections catch up.

**Recommendation:** ship **hybrid** first for production; **redis-only** as optional
single-infra mode for teams that want no SQL.

---

## Implementation slices

| # | Deliverable |
|---|-------------|
| 1 | `RuntimeStorage.transaction` on memory + sqlite + prisma |
| 2 | `src/storage/redis/RuntimeStorageRedis.ts` — full redis-only adapter + tests |
| 3 | `src/storage/hybrid/` — router + `layerRuntimeStorageHybrid` + default policy |
| 4 | Lease acquire/release on hybrid Redis route (plan 12) |
| 5 | Rate limit consume on hybrid Redis route (plan 13) |
| 6 | Docs + example compose + changeset |

---

## What hybrid is NOT

- Not automatic on every app — **opt-in layer**.
- Not “SQL + app-wired Effect RateLimiter Redis”.
- Not replacing facet class names or subpaths (`store/QueueResource` stays).

---

## Open (owner)

- Mixed SQL+Redis transaction strictness vs audit-after-success.
- Whether any hot types stay on SQL in hybrid default policy.
- Redis-only query story for dashboard (materialized reads vs dual read path).
