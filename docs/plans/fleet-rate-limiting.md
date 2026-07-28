# Plan: fleet rate limiting (Gates + HttpApiClient)

**Status:** **Eng’d + tip-synced** — R1–R4 (incl. opt-in adaptive 429). **Closed** — no Hyperlink-backed store; Effect store layers only.  
**Agent:** 4 (`cursor/hyperservice-open-deps-5679`).  
**Depends on:** Effect `4.0.0-beta.98` `effect/unstable/persistence/RateLimiter`; WorkPool `rateLimit` precedent; optional peer `ioredis` + `@effect/platform-node` `NodeRedis`.  
**Product context:** HttpApiClient Gate = local routes + wire observe/limit nest; ApiMetrics absorbed (not a migrate track). Fleet rate limiting is the substrate that nest uses.

---

## Research — what Effect already ships

Module: `effect/unstable/persistence/RateLimiter` (pinned with our `effect` dep; also in `repos/effect`).

### Services

| Piece | Role |
|-------|------|
| **`RateLimiter`** | `consume` / `adaptiveConsume` / `adaptiveFeedback` |
| **`RateLimiterStore`** | Backing counters (pluggable) |
| **`layer`** | `RateLimiter` from current store |
| **`layerStoreMemory`** | Daemon-local store |
| **`layerStoreRedis` / `makeStoreRedis`** | Shared store via Lua (true multi-process) |
| **`makeWithRateLimiter`** | Wrap an effect: consume then run (delay if needed) |
| **`makeSleep`** | Sleep until permitted (`onExceeded: "delay"`) |

### `consume` options

```ts
{
  key: string
  limit: number
  window: Duration.Input
  algorithm?: "fixed-window" | "token-bucket"  // default fixed-window
  onExceeded?: "delay" | "fail"               // default fail
  tokens?: number                             // default 1
}
```

**Result:** `{ delay, limit, remaining, resetAfter }`.  
**Errors:** `RateLimiterError` → `RateLimitExceeded` (`retryAfter`, `key`, `limit`, `remaining`) or `RateLimitStoreError`.

### Adaptive path

`adaptiveConsume` + `adaptiveFeedback` learn from HTTP **429 + Retry-After** (cooldown → learning → learned). Directly relevant to HttpApiClient egress against upstream APIs.

### Critical property for fleets

> “throttle workers across fibers and **processes that share the same store**.”

- **Memory store** = one process (or one Node runtime).  
- **Redis store** = fleet-wide atomic consume (Lua).  
Effect already solved cross-process limiting **when the store is shared**. We do not need to invent fixed-window / token-bucket.

---

## What Hyperlink already does

### WorkPool — Effect RateLimiter (Eng’d)

- Config: `rateLimit?: { limit, window, algorithm?, onExceeded?, tokens?, key? }`
- Workers **consume before** the concurrency Semaphore
- Auto-provides `queueRateLimiterLayer` = `RateLimiter.layer` + **`layerStoreMemory`**
- Apps can swap in Redis: compose `RateLimiter.layerStoreRedis` at the root
- Docs: concurrency = in-flight; rateLimit = starts per window (orthogonal)

### Gate — Semaphore + `rateLimit` (R1 Eng’d)

- `Gate` `concurrency` = in-process Semaphore (permits in flight)
- `Gate` `rateLimit?: { limit, window, … }` = Effect `RateLimiter` **before** the Semaphore
- Store = presence-driven `serviceOption(RateLimiterStore)`; Soft `layerStoreMemory` when absent
- Defaults: `onExceeded: "delay"`, `algorithm: "fixed-window"`, key = gate name / resource id
- `Gate.httpApiClient` still concurrency-only (R4)
- ApiMetrics = sibling Tag reading a usage registry (observe, not enforce) — absorbed in R2/R4

### Gap (remaining)

| Need | Today |
|------|--------|
| Rate (tokens / window) on Gate run | **Eng’d (R1)** |
| Same budget across fleet Nodes | Compose `RateLimiter.layerStoreRedis` at root (R3 recipe/docs) |
| Observe remaining / reject / delay on a Hyperlink nest | Missing (ApiMetrics is usage stats, not limiter state) — R2 |
| Adaptive upstream 429 learning on HttpApiClient | Effect has API; we don’t wire it — R4 |

---

## Proposal — how fleet rate limit is enforced

### Law

1. **Algorithm = Effect `RateLimiter`.** Do not fork a second fixed-window / token-bucket.  
2. **Fleet = shared `RateLimiterStore`.** Use **Effect’s store layers only** (today Soft memory / Redis). No Hyperlink-backed store adapter.  
3. **Concurrency ≠ rate limit.** Keep Semaphore for in-flight; RateLimiter for temporal budget. Same orthogonal split as WorkPool.  
4. **Egress stays local.** HttpApi routes remain `Hyperlink.local` — consume runs on the node that holds the real Layer; peers share the **store**, not route RPC.  
5. **ApiMetrics dies into the Gate nest** as observation of limiter + usage, not a separate enforce path.

### Architecture

```
                    ┌─────────────────────────────┐
                    │  RateLimiterStore (shared)  │
                    │  memory Soft | Redis (Effect) │
                    └────────────▲────────────────┘
                                 │ consume(key, …)
           ┌─────────────────────┴─────────────────────┐
           │                                           │
    Node A Gate Layer                           Node B Gate Layer
    (local routes + nest)                       (local routes + nest)
           │                                           │
    RateLimiter.consume ──► route / run           same
           │
    nest.observe (wire) ──► remaining, resetAfter, rejects
```

Every peer that can egress **must** see the same store. Without a shared store, “fleet rate limit” is a lie (N× limit).

### Keying

Canonical key (proposal):

```text
gate:{kind}:{resourceKey}:{bucket?}
```

Examples:

- `gate:httpApi:app/GithubClient` — whole client  
- `gate:httpApi:app/GithubClient:posts` — per group (optional)  
- `gate:run:app/Double` — ordinary Gate.Tag  

HttpApiClient may also use **upstream adaptive** keys (`upstream:{host}`) via `adaptiveConsume` / `adaptiveFeedback` on 429.

### Gate / HttpApiClient wiring (product)

```ts
// Conceptual — not Eng’d API
class Github extends Gate.httpApiTag<Github>()("app/Github", MyApi, {
  rateLimit: {
    limit: 5000,
    window: "1 hour",
    algorithm: "token-bucket",
    onExceeded: "delay", // or "fail"
  },
  // concurrency remains separate (Semaphore)
  concurrency: 10,
}) {}
```

On each local route call:

1. `RateLimiter.consume` (shared store)  
2. If delay → sleep (or fail)  
3. Semaphore permit  
4. HTTP / run body  
5. Optional `adaptiveFeedback` on response  
6. Emit observe facts to the wire nest  

### Observe nest (absorbs ApiMetrics)

Wire (clientable), e.g.:

| Field | Shape | Source |
|-------|--------|--------|
| `limit` / `remaining` / `resetAfter` | `ref` or `effect` | last consume / store snapshot |
| `exceeded` / usage windows | `stream` / `ref` | existing registry + limiter outcomes |

No sibling `ApiMetrics.Tag`. Dashboard dials the Gate Tag’s nest only.

### Effect `RateLimiter` layers (what actually ships)

| Layer | Provides | Needs | Notes |
|-------|----------|-------|--------|
| **`RateLimiter.layer`** | `RateLimiter` | `RateLimiterStore` | Service only |
| **`RateLimiter.layerStoreMemory`** | `RateLimiterStore` | — | Daemon-local |
| **`RateLimiter.layerStoreRedis(opts?)`** | `RateLimiterStore` | `Redis.Redis` | Lua atomic; fleet-capable |
| **`RateLimiter.layerStoreRedisConfig`** | `RateLimiterStore` | `Config` + `Redis` | Config-wrapped Redis |

**There is no SQL `RateLimiterStore` in Effect today.**  
(Contrast: `PersistedQueue` / `Persistence` have `layerStoreSql` / `layerSql` — RateLimiter does not.)

WorkPool composition today:

```ts
// auto when rateLimit is set — memory only
queueRateLimiterLayer = Layer.provide(RateLimiter.layer, RateLimiter.layerStoreMemory)
// app override for cross-process:
Layer.provide(…, RateLimiter.layerStoreRedis())
```

### Presence-driven store — same switch as WorkPool durability

WorkPool queue durability (**LOCKED pattern** — keep for Gate rate limit):

```ts
// The layer is the switch — no config flag.
const durableStoreOption = yield* Effect.serviceOption(DurableQueueStore)
// Some → store is source of truth
// None → ephemeral in-memory lanes
```

Gate / HttpApi **rate limit store** follows that, not a config enum:

```ts
// Conceptual Eng
const storeOpt = yield* Effect.serviceOption(RateLimiterStore)
const store = Option.getOrElse(storeOpt, () => memoryStore) // Soft fallback — see below
```

| | WorkPool `DurableQueueStore` | Gate `RateLimiterStore` |
|--|------------------------------|-------------------------|
| Switch | **presence** (`serviceOption`) | **presence** (`serviceOption`) |
| Config flag? | No | No (`rateLimit: { limit, window, … }` only configures the *policy*) |
| Absent | Ephemeral queue (no durable default — memory durability is a contradiction) | **Soft memory** `layerStoreMemory` (single-node rate limit is valid) |
| Present | SQLite / backend layer at root | Effect store layer at root (today Redis) |
| Scope escape | Don’t provide the store layer to queues that must stay ephemeral | Same — omit store from that Gate’s provide tree |

**Policy vs store stay separate:**

- `rateLimit?: { limit, window, algorithm?, onExceeded?, key? }` — “this Gate is rate-limited” (like today on WorkPool).  
- Ambient **`RateLimiterStore`** — where tokens live (Effect Soft memory / Effect Redis fleet; whatever else Effect ships later).

App composition (fleet):

```ts
Layer.mergeAll(
  Gate.layer(Github, …),
  Gate.layer(Slack, …),
).pipe(
  Layer.provide(RateLimiter.layerStoreRedis({ prefix: "fleet:" })), // one store → all Gates see it via serviceOption
  Layer.provide(NodeRedis.layer({ host, port })),
)
```

Single-node / tests: omit store layer → Soft memory (R fulfilled), same Soft spirit as `Store.withDefaultStorage`.

**Not** the AppStore Soft path (`Storage` is never `serviceOption` — cutover law). This is the **durability-plane** pattern (`DurableQueueStore`), which *is* `serviceOption`.

Fail loud if `distributed` + memory Soft only? **Lean: docs first; optional Soft die later.**

### What we do **not** do in v1

- Invent peer-gossip / CRDT token sync without a shared store (overshoot-prone, hard to test).  
- Proxy HttpApi routes over Hyperlink RPC for limiting.  
- Replace Gate `concurrency` with RateLimiter (different job).  
- Require Redis for every Gate (memory stays valid for one node).

---

## Relation to HttpApiClient reshape

Fleet rate limiting is **first-class Gate substrate**. HttpApiClient update **uses** it:

1. Eng Gate `rateLimit` + shared store composition (+ observe nest skeleton).  
2. Reshape HttpApiClient → Hyperlink Tag: local routes, wire nest, bake `rateLimit` + optional adaptive 429.  
3. Delete / stop recommending sibling ApiMetrics.

---

## Open decisions (owner)

1. ~~How is the store selected?~~ **LOCKED (owner):** presence-driven `serviceOption(RateLimiterStore)` like `DurableQueueStore`; Soft memory when absent.  
2. ~~**Fleet store backend:**~~ **LOCKED:** Effect store layers only — Soft memory / Redis today (`NodeRedis` + `layerStoreRedis`). No Hyperlink-backed store; adopt further Effect stores if/when they ship.  
3. **Distributed + memory Soft:** docs-only vs fail-loud? — lean docs  
4. ~~**Default `onExceeded` for Gates:**~~ **LOCKED (R1 lean):** `"delay"`  
5. ~~**Nest name / shape / collision:**~~ **LOCKED (bake 2026-07-27):** nest default **`metrics`**, **flat siblings**. Escape = const **`metricsKey`** rename (typed); fail-loud if Api group id equals chosen key.  
6. ~~**Per-route keys / key identity:**~~ **LOCKED (bake 2026-07-27):** whole-client v1. Service key ≠ bucket key (separate fields). **`rateLimit.key` optional — omit inherits service key.** Metadata exposes both + `metricsKey`. Nest = live data only. Per-route later.

---

## Suggested Eng slices

| Slice | Scope |
|-------|--------|
| **R0** | This proposal + owner locks above |
| **R1** | ~~Gate config `rateLimit` + consume before Semaphore; Soft memory / presence store; tests with `TestClock`~~ **Eng’d** |
| **R2** | ~~Light **`metrics` nest** on ordinary Gate~~ **Eng’d** — wire nest `remaining` / `resetAfter` / `exceeded`; Tag metadata `rateLimitKeyOf` / `metricsKeyOf`; live updates when `rateLimit` set |
| **R3** | ~~Fleet recipe + shared-store tests (Gate + WorkPool presence-driven); Soft vs shared contrast; demo/docs~~ **Eng’d** (shared memory CI stand-in) |
| **R3b** | ~~Live Redis proof~~ **Eng’d** — `NodeRedis.layer` + `RateLimiter.layerStoreRedis`; Gate/WorkPool live suites + child-process peer; `Persistence.layerRedis` / `PersistedQueue.layerStoreRedis` smoke; `docker-compose.redis.yml`; demo auto-detects Redis |
| **R4** | ~~`Gate.HttpApiClient` Tag + nest + adaptive 429~~ **Eng’d** — `httpApiClientLayer(Tag)`; `usage`/`windows`; `adaptive: true` |
| **R4b** | ~~Delete sibling `ApiMetrics` + dashboard nest parity~~ **Eng’d** — module/subpath removed; web/TUI API widgets surface `remaining` / `resetAfter` / `exceeded` |
| **R5** | ~~Hyperlink-backed `RateLimiterStore`~~ **rejected** — Effect store layers only (`layerStoreMemory` / `layerStoreRedis`; adopt further Effect stores if/when they ship) |

---

## References

- Effect: `node_modules/effect/src/unstable/persistence/RateLimiter.ts`  
- Effect tests: `repos/effect/packages/effect/test/unstable/persistence/RateLimiter.test.ts`  
- WorkPool: `src/internal/workPool.ts` (`WorkPoolRateLimitOptions`, `queueRateLimiterLayer`, `acquireQueueRateLimitAwait`)  
- Guide: `docs/guides/work-pools.md` (concurrency vs rateLimit)  
- Gate concurrency: `src/internal/gate.ts` (Semaphore)  
- HttpApi instrument / usage registry: `src/internal/httpApiClient.ts`, `src/ApiUsageSchema.ts`  
- Product bake: local routes + wire nest — owner chat 2026-07-27; [`wire-groups-and-identity.md`](./wire-groups-and-identity.md), [`service-shapes.md`](./service-shapes.md)
