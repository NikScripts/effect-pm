# Agent 3 — Store followers implementation plan

**Status:** plan — awaiting owner unlock before code.  
**Branch:** `cursor/logs-store-followers-plan-906e` (from `integration`).  
**Brief:** [`agent-03-logs-p1.md`](./agent-03-logs-p1.md) (owner-locked registration-follower model).  
**Out of scope this slice:** named handles (Agent D); level pipes; remote `Resource.logs` RPC; resurrecting Phase 5 surfaces.

---

## Goal

Finish the durable half of the logs platform:

- One capture (`Logs.layer`) and one bus (`LogRelay`) stay as shipped.
- Every **store registration** that should persist logs forks a **follower** on that bus.
- Followers share one factory (grown from today’s `persistLayer` seed).
- Registrations expose an implicit Store shape **`log`** → `handle.log.append` / `handle.log.read`.
- Node durability uses a **node store registration** (`Resource.store(node)`), not a logs-only special case forever.
- The standalone `LogStore` + `Logs.persistLayer` story shrinks to a thin compat wrapper, then exits the product path.

---

## End-state shape (app code)

### Node + resources on one `Store.Service`

```ts
import * as Store from "@nikscripts/effect-pm/Store";
import * as Logs from "@nikscripts/effect-pm/Logs";
import * as QueueResource from "@nikscripts/effect-pm/QueueResource";
import * as Process from "@nikscripts/effect-pm/Process";
import * as Resource from "@nikscripts/effect-pm/Resource";
import { WnbaNode, BoxScoreQueue, LiveScorePoller } from "./hub";

/**
 * One SQLite/memory DB. Node registration = whole-runtime journal.
 * Resource registrations = scoped journals (hasKey match).
 * Each registration forks the shared follower when its store layer builds.
 */
export class WnbaAppStore extends Store.Service<WnbaAppStore>()(
  "@repo/WnbaAppStore",
)([
  Resource.store(WnbaNode),                    // node registration (see §Node store) — implicit `log` shape
  QueueResource.store(BoxScoreQueue),          // + implicit `log` shape
  Process.store(LiveScorePoller),              // + implicit `log` shape
]) {}

const nodeStack = Resource.httpServer([/* … */]).pipe(
  Layer.provide(Logs.layer),                   // capture + relay ONLY — no second logger
  Layer.provide(WnbaAppStore.layerMemory),     // followers fork here
  // NO Logs.persistLayer(WnbaNode)
  // NO LogStore.layerMemory
);
```

### Shape naming + read payload (owner-locked 2026-07-14)

Not top-level `appendLog` / `logQuery`. Use a normal Store **shape** named `log`.

**Remove** the per-shape read-payload argument from `Store.shape`. One system payload for every shape; per-shape variance is typed **field filters** only.

| Locked | Choice |
|--------|--------|
| Shape API | `Store.shape(row)` only — no second schema arg |
| Query style | Drizzle **relational query API** object `where` — **fully featured / basically identical** |
| Nesting | **Required in v1** (nested row fields / nested `where`) |
| Operators in v1 | Full RQB set: bare eq shorthand, `{ eq, ne, gt, gte, lt, lte, in, notIn, like, ilike, … }`, `AND` / `OR` / `NOT` |
| Composable column-ref API (`eq(col, v)` imports) | **Later** — object `where` is v1; SQL-builder style can wait |

```ts
// Before (delete)
Store.shape(readingSchema, Schema.Struct({ limit: Schema.optional(Schema.Number) }))

// After
Store.shape(readingSchema)

// Shared baked-in payload + Drizzle-RQB-identical nested where
yield* handle.readings.read({
  limit: 50,
  where: {
    value: 72,                              // shorthand eq
    meta: {
      source: { eq: "probe" },
      count: { gte: 1, lt: 10 },
    },
    OR: [{ value: { gt: 100 } }, { value: { lt: 0 } }],
    // unknownTop: 1,                       // type error
  },
});

// Implicit logs shape — same system
{
  log: Store.shape(LogEntrySchema),
}
yield* handle.log.append(entry);
yield* handle.log.read({
  limit: 200,
  where: {
    level: { in: ["Warn", "Error"] },
    annotations: { /* nested if row exposes nested structure */ },
  },
});
```

`where` is typed from the **row schema** (nested structs included). Mirror Drizzle RQB operator surface as closely as the in-memory/EventJournal engine can honor (document any SQL-only ops like `arrayContains` if skipped or stubbed). Shared options (`limit`, time window, …) live on the baked-in payload — identical for every shape.

Do **not** copy the interim `LogStore` fat `logQueryPayloadSchema` onto the shape. Lineage helpers may still be thin customs/`Resource.logs().query` facades over `log.read({ where: … })`.

### Prerequisite: Store unified read payload (blocks followers-1)

Landing registration followers on a clean `log` shape requires this Store change first (or in the same unlock as `followers-1`):

1. `Store.shape(row)` — drop overload with read schema; migrate all call sites (`queue`/`process`/`run`/`logStore` specs, tests, guides).
2. Bake one read-payload type into shape `.read` (shared windowing + `where`).
3. Type `where` from `Schema.Schema.Type<Row>` with nested paths.
4. Runtime: decode system payload → apply `limit`/`before`/`after` → apply nested `where` equality/ops on decoded rows.
5. Changeset — public Store API break.

### What a registration-native write looks like (internals, not app code)

When `WnbaAppStore.layerMemory` builds, for each registration the platform:

1. Materializes the contract handle (existing Store path).
2. Forks `followRelay({ scopeKey, match, level, append })` in the layer scope.
3. On each relay line: level gate → match → memo → `handle.log.append(...)`.

Reads:

```ts
const nodeHandle = yield* WnbaAppStore.at(WnbaNode);
const nodeRows = yield* nodeHandle.log.read({ limit: 200 });

const pollerHandle = yield* WnbaAppStore.at(LiveScorePoller);
const pollerRows = yield* pollerHandle.log.read({ limit: 50 });

// Live still comes from the relay (unchanged product)
const live = yield* Resource.logs(LiveScorePoller);
live.stream.pipe(Stream.filter(LogEntry.hasKey(LiveScorePoller.key)));
```

`Resource.logs(tag).query` becomes a thin redirect onto that registration’s `log.read` (or `log.query` alias) when a store layer is present (Phase 3).

---

## Phase 0 — Shared follower factory

**Today** (`src/internal/logs/storeFollower.ts`): hard-wired to `LogStore.recordBatch(node, …)` and a local monotonic counter. No match predicate, no level gate, no memo, no registration handle.

**Target API** (internal, sketch):

```ts
// src/internal/logs/storeFollower.ts
import type { Predicate } from "effect";
import type { LogEntry } from "../../LogEntry";
import type { StoreLogLevel } from "../store/types";
import { LogRelay } from "./relay";

export interface FollowRelayOptions {
  /** Registration scope — node key or tag.key. Memo key namespace. */
  readonly scopeKey: string;
  /** Node: () => true (or atRoot). Resource: LogEntry.hasKey(scopeKey). */
  readonly match: ReturnType<typeof LogEntry.hasKey> | Predicate.Predicate<LogEntry>;
  /** From Store.logLevel* / registration.logLevel until logStoreLevel splits off. */
  readonly storeLevel: StoreLogLevel;
  /**
   * Durable append for one row. Callers close over the registration’s appendLog
   * (or interim LogStore.record for the thin persistLayer wrapper).
   */
  readonly append: (row: {
    readonly entryId: string;
    readonly entry: LogEntry;
  }) => Effect.Effect<void, never>;
  /** Batching — keep today’s 64 / 250ms defaults. */
  readonly batchSize?: number;
  readonly batchWindow?: Duration.Duration;
}

/**
 * Layer that forks a scoped subscriber on LogRelay.
 * Requires LogRelay in the environment. Provides nothing.
 */
export const followRelayLayer = (
  options: FollowRelayOptions,
): Layer.Layer<never, never, LogRelay> =>
  Layer.scopedDiscard(
    Effect.gen(function* () {
      const relay = yield* LogRelay;
      const seen = yield* Ref.make(new Set<string>()); // memo (scopeKey, lineId) → "lineId" set
      const queue = yield* Queue.unbounded<LogEntry & { readonly lineId: string }>();

      yield* Effect.forkScoped(
        relay.stream.pipe(
          Stream.runForEach((entry) =>
            Effect.gen(function* () {
              if (!levelAllows(options.storeLevel, entry.level)) return;
              if (!options.match(entry)) return;
              const lineId = lineIdOf(entry);
              const key = lineId;
              const already = yield* Ref.get(seen);
              if (already.has(key)) return;
              yield* Ref.update(seen, (s) => new Set(s).add(key));
              yield* Queue.offer(queue, { ...entry, lineId });
            }),
          ),
        ),
      );

      yield* Effect.forkScoped(
        Stream.runForEach(
          Stream.groupedWithin(
            Stream.fromQueue(queue),
            options.batchSize ?? 64,
            options.batchWindow ?? Duration.millis(250),
          ),
          (batch) =>
            Effect.forEach(
              batch,
              (row) =>
                options.append({
                  entryId: row.lineId,
                  entry: stripLineId(row),
                }),
              { concurrency: 1, discard: true },
            ),
        ),
      );
    }),
  );
```

### `lineId` proposal (part of this slice)

Stamp a stable id **once** at capture/publish on the relay entry (annotation or struct field), so every follower memos the same token.

```ts
// in relay capture path (sketch)
annotations: {
  ...existing,
  [LogAnnotationKeys.lineId]: yield* nextLineId, // monotonic per LogRelay instance
}
```

Interim fallback if we defer the stamp: hash(`date|level|message|lineageJSON`) inside the factory — document collision risk; prefer relay-assigned id in the same PR if cheap.

### Thin wrapper for today’s API

```ts
// Logs.persistLayer(node) becomes:
export const persistLayer = (node: NodeLogKey | NodeLogKeySource) => {
  const nodeKey = resolveNodeLogKey(node);
  return followRelayLayer({
    scopeKey: nodeKey,
    match: () => true,
    storeLevel: "All",
    append: ({ entryId, entry }) =>
      Effect.flatMap(LogStore, (store) =>
        store.record(nodeKey, entryId, {
          ...entry,
          annotations: {
            ...entry.annotations,
            [LogAnnotationKeys.node]: nodeKey,
          },
        }),
      ).pipe(Effect.orDie),
  });
};
```

Apps keep working during migration; the product docs move to `Logs.registerNode` + store layers.

**Done when:** `followRelayLayer` exists; `persistLayer` is a wrapper; existing `test/logs-relay.test.ts` / host log history tests still green.

---

## Phase 1 — Implicit `log` shape on toolkit (+ node) registrations

### Contract merge

Today `Process.store(tag)` / `QueueResource.store(tag)` return `facetStoreRegistration(tag, analyticsContract)`. Extend the built-in contract with a normal Store shape named **`log`**:

```ts
// src/internal/store/logShapes.ts (new)
import * as Store from "../../Store";
import { LogEntrySchema } from "../../LogEntry";

export const withImplicitLogShape = <C extends StoreContractValue>(
  contract: C,
): /* extended contract */ =>
  Store.extend(contract, {
    log: Store.shape(LogEntrySchema), // default empty read payload
  });
```

Materialized handle:

```ts
yield* handle.log.append(entry);
yield* handle.log.read(); // or read({ limit }) only if we opt into a small default payload schema
```

Follower closes over **`handle.log.append`**. Lineage-scoped product reads (`Resource.logs(tag).query`, dashboard helpers) are custom methods or thin facades over `log.read` + in-memory / shared filters — not a second schema on the shape. Interim `LogStore` fat query payload stays on the compat class only until removed.

### Apply at registration builders

```ts
// Process.store / QueueResource.store / CustomQueueResource.store / RunResource.store
export function store(tag: StoreScopeTag, extended?: StoreShapes) {
  const builtIn = withImplicitLogShape(makeProcessStoreAnalyticsContract(tag));
  return extended === undefined
    ? facetStoreRegistration(tag, builtIn)
    : facetStoreRegistration(tag, builtIn, extended);
}
```

### Node store registration (not `Logs.registerNode`)

Logs are **not** the only future thing a node might persist. Prefer a **node store registration** parallel to resources — sketch:

```ts
// Preferred product API (owner-leaning)
Resource.store(WnbaNode)                    // empty / base node contract + implicit `log` shape
Resource.store(WnbaNode, { /* future node domain shapes */ })

// Optional sugar if we keep design-doc naming
WnbaNode.logs                               // registration that is log-only (still a Store.register)
```

`Logs.registerNode` from the first plan draft is **withdrawn** as the primary story — node durability hangs off `Resource.store(node)` (name TBD in unlock checklist), with the same implicit `log` shape and the same follower factory (match-all / `atRoot`).

**Done when:** a `Store.Service` that includes `Process.store(tag)` and `Resource.store(node)` materializes `handle.log.append` / `handle.log.read`; unit test writes a row and reads it back **without** any follower yet (contract-only).

---

## Phase 2 — Fork followers from store layer build

When `Store.Service.layer` / `layerMemory` (and standalone/`layerDefaultMemory` paths that materialize scopes) build, for each registration that carries log shapes:

```ts
// inside buildMemoryLayerForAggregate / buildStandaloneMemoryLayer (sketch)
const followerLayers = registrations
  .filter(hasImplicitLogShapes)
  .map((reg) =>
    followRelayLayer({
      scopeKey: reg.scopeKey,
      match: isNodeRegistration(reg)
        ? () => true
        : LogEntry.hasKey(reg.scopeKey),
      storeLevel: reg.logLevel ?? "All",
      append: (row) =>
        Effect.gen(function* () {
          const handle = yield* bridge.at(reg.scopeKey /* + contract */);
          yield* handle.log.append(annotateNodeIfNeeded(reg, row));
        }).pipe(Effect.orDie),
    }),
  );

return Layer.mergeAll(
  layerFromBuiltBridge(tag, bundle, bridge),
  ...followerLayers,
).pipe(Layer.provide(/* journal */));
```

**Requirement:** `LogRelay` must be in scope when the store layer builds, or followers no-op / wait. Document the composition rule:

```ts
// Correct
Layer.provide(AppStore.layerMemory).pipe(Layer.provide(Logs.layer))
// or provideMerge — same idea: Logs.layer present for the store build

// Wrong — store followers cannot subscribe
Layer.provide(AppStore.layerMemory) // alone, no LogRelay
```

If `LogRelay` is absent: **skip forking** (durable off, live still optional). Do not install a second capture logger.

### Single-write / memo rule (this slice)

| Rule | Meaning |
|------|---------|
| Memo key | `(scopeKey, lineId)` inside each follower |
| Same scope, same line, twice on the bus | Second append suppressed |
| Node scope vs resource scope | **Different** `scopeKey`s → both may store a copy (node journal for cross-resource dashboards; resource partition for scoped tables). That is intentional, not a double-write bug. |
| Forbidden | Running interim `Logs.persistLayer` → `LogStore` **and** `Resource.store(node)` (node registration follower) for the **same** node key in one process — two writers for the **same** scope. Migration: pick one. Compat tests cover wrapper-only or node-store-only. |

**Done when:** `test/logs-follower.test.ts` covers match / memo / level gate (using today’s `Store.logLevel*` as `storeLevel`); resource-web or a focused example runs without `persistLayer`.

---

## Phase 3 — Shrink interim `LogStore` / `persistLayer` + wire readers

| Surface | During slice | After slice (docs) |
|---------|--------------|--------------------|
| `Logs.persistLayer` | Thin wrapper over `followRelayLayer` → `LogStore` | Deprecated; example migrate to `Resource.store(node)` on app store |
| `LogStore` class | Still exported for compat / tests | Prefer node store registration; deprecate in a later changeset if owner unlocks |
| `Logs.byNode` / `Resource.logs().query` | Prefer registration `log.read` when `Storage` present; fall back to `LogStore.load` while compat lives | Document registration path as SSOT |
| `docs/LOGS.md` | Rewrite write-path diagram to followers | — |
| `examples/resource-web/server.ts` | Replace `persistLayer` + `LogStore.layerMemory` with app `Store.Service` that registers the node + resources | — |

Example migration for `liveNode` in `server.ts`:

```ts
// Before
Layer.provide(Logs.layer),
Layer.provideMerge(Logs.persistLayer(LiveNode)),
Layer.provide(LogStore.layerMemory),
Layer.provide(Store.layerDefaultMemory),

// After
class LiveNodeStore extends Store.Service<LiveNodeStore>()(
  "@example/LiveNodeStore",
)([
  Resource.store(LiveNode),
  Process.store(LiveScorePoller),
]) {}

Layer.provide(Logs.layer),
Layer.provide(LiveNodeStore.layerMemory),
```

**Done when:** `LOGS.md` write diagram matches; example + tests green; changeset describes the public registration follower API and deprecations.

---

## Tests (concrete)

### `test/logs-follower.test.ts` (new)

1. **Match** — publish three lines (keys A, B, A); resource follower for A appends two rows; node follower appends three.
2. **Memo** — publish the same `lineId` twice on the bus; follower appends once.
3. **Level gate** — registration `Store.logLevelWarn`; Info dropped, Warn appended.
4. **No double scope writer** — constructing both `persistLayer(node)` and `Resource.store(node)` in one test runtime either fails fast or is documented as unsupported; preferred: test asserts node-store-only path.

### Keep green

`test/logs-resource.test.ts`, `test/logs-relay.test.ts`, `test/host-logs-history.test.ts`, `test/fixtures/logsEnv.ts` — update fixtures to either wrapper path or registration path consistently.

### Verify

```bash
pnpm typecheck && pnpm test && pnpm lint
```

---

## Files (expected touch set)

| Area | Paths |
|------|-------|
| Follower factory | `src/internal/logs/storeFollower.ts`, possibly `relay.ts` (lineId) |
| Log shapes | `src/internal/store/logShapes.ts` (new), `logStoreSpec.ts` (reuse / slim) |
| Registration builders | `Process.ts` / `QueueResource.ts` / `CustomQueueResource.ts` / `RunResource.ts` `store()` |
| Layer fork | `src/Store.ts` layer builders / `internal/store/defineStore.ts` / `scopeBridge.ts` as needed |
| Public Logs | `src/Logs.ts` — `registerNode`; `persistLayer` wrapper |
| Docs / examples | `docs/LOGS.md`, `examples/resource-web/server.ts`, test fixtures |
| Tests | `test/logs-follower.test.ts`, fixture updates |
| Changeset | `.changeset/*.md` |

**Do not touch:** Agent D named-handle surfaces; control-spec `logs` groups; `NodeLogs`.

---

## Ordered follow-ups (not this unlock)

1. **Level pipes (A)** — `Resource.logStoreLevel` / `logStreamLevel` / …; split store channel from today’s single `Store.logLevel*`. Wire `logStoreLevel` into `FollowRelayOptions.storeLevel`.
2. **Remote per-resource logs (C)** — after local registration `logQuery` is real; decide C1 helpers vs C2 inject vs C3 NodeStatus RPC.
3. **`Resource.logs().stream` footgun** — pre-filter vs helper; pair with C.
4. **Hard-remove** standalone `LogStore` / `persistLayer` after one release shim (owner unlock).

---

## Implementation order (for unlock)

| Unlock name | Delivers |
|-------------|----------|
| **`store-read-0`** | Unified baked-in read payload + nested RQB `where`; remove `Store.shape` payload arg; migrate call sites |
| **`followers-0`** | Shared `followRelayLayer` + `persistLayer` wrapper + lineId decision |
| **`followers-1`** | Implicit `log` shape on `*.store(tag)` + `Resource.store(node)` (or chosen node API) |
| **`followers-2`** | Fork followers from store layer build + `test/logs-follower.test.ts` |
| **`followers-3`** | Example + `LOGS.md` + `Resource.logs`/`byNode` reader wiring + changeset |

`store-read-0` before (or merged with) `followers-1`. Owner may unlock slices individually.

---

## Owner unlock checklist

1. ~~Read style~~ — **locked:** remove per-shape payload arg; one baked-in payload; Drizzle RQB nested `where` in v1; composable `eq`/`and` later.  
2. Confirm **v1 operator set** on `where` values: equality shorthand only, or also `{ eq, ne, gt, gte, lt, lte, in, … }` in v1.  
3. Confirm node registration API: **`Resource.store(WnbaNode)`** vs log-only sugar (`WnbaNode.logs`) vs both.  
4. Confirm **node + resource both active** ⇒ two buckets (copies OK) vs nest resource writes under node only. Plan assumes **copies OK, memo per scope**.  
5. Confirm **`lineId`**: relay-assigned annotation (recommended) vs hash fallback.  
6. Unlock named slice: `store-read-0` / `followers-0` / …  
7. Levels + remote remain parked until a later unlock.

**Stop — no code until unlock.**
