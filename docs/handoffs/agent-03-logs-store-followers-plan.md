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
- Registrations expose implicit **`appendLog`** + **`logQuery`**.
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
  Logs.registerNode(WnbaNode),                 // scopeKey = WnbaNode.key, match all / atRoot
  QueueResource.store(BoxScoreQueue),          // + implicit appendLog / logQuery
  Process.store(LiveScorePoller),              // + implicit appendLog / logQuery
]) {}

const nodeStack = Resource.httpServer([/* … */]).pipe(
  Layer.provide(Logs.layer),                   // capture + relay ONLY — no second logger
  Layer.provide(WnbaAppStore.layerMemory),     // followers fork here
  // NO Logs.persistLayer(WnbaNode)
  // NO LogStore.layerMemory
);
```

### What a registration-native write looks like (internals, not app code)

When `WnbaAppStore.layerMemory` builds, for each registration the platform:

1. Materializes the contract handle (existing Store path).
2. Forks `followRelay({ scopeKey, match, level, append })` in the layer scope.
3. On each relay line: level gate → match → memo → `appendLog`.

Reads:

```ts
// Node journal (everything captured on this runtime)
const nodeRows = yield* WnbaAppStore.at(WnbaNode).logQuery({ limit: 200 });

// One resource’s partition (follower only appended hasKey(LiveScorePoller.key))
const pollerRows = yield* WnbaAppStore.at(LiveScorePoller).logQuery({ limit: 50 });

// Live still comes from the relay (unchanged product)
const live = yield* Resource.logs(LiveScorePoller);
live.stream.pipe(Stream.filter(LogEntry.hasKey(LiveScorePoller.key)));
```

`Resource.logs(tag).query` becomes a thin redirect onto that registration’s `logQuery` when a store layer is present (exact wiring in Phase 3 below).

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

## Phase 1 — Implicit `appendLog` / `logQuery` on toolkit registrations

### Contract merge

Today `Process.store(tag)` / `QueueResource.store(tag)` return `facetStoreRegistration(tag, analyticsContract)`. Extend the built-in contract (or a fixed merge helper applied inside `facetStoreRegistration`) with log shapes:

```ts
// src/internal/store/logShapes.ts (new)
import { LogEntrySchema } from "../../LogEntry";
import * as Store from "../../Store";

/** Payload for registration-scoped durable log reads. */
export const registrationLogQuerySchema = Schema.Struct({
  lineageContains: Schema.optional(Schema.String),
  atRoot: Schema.optional(Schema.String),
  atLeaf: Schema.optional(Schema.String),
  from: Schema.optional(Schema.Number),
  to: Schema.optional(Schema.Number),
  limit: Schema.Number,
  sort: Schema.Literals(["asc", "desc"] as const),
});

export const withImplicitLogShapes = <C extends StoreContractValue>(
  contract: C,
  scopeKey: string,
): /* extended contract */ =>
  Store.extend(contract, {
    // Name locked by Agent 2 plan — append path for the follower
    appendLog: Store.append(LogEntrySchema),
    logQuery: Store.query({
      payload: registrationLogQuerySchema,
      result: Schema.Array(LogEntrySchema),
    }),
  });
```

Exact naming on the materialized handle must match Store shape conventions (`append` / custom query method). If `Store.append` always creates `{ shapeKey: { append, read } }`, the follower closes over `handle.appendLog.append(entry)` (or whichever path the contract materializer produces). Plan rule: **one obvious write method the follower calls; one query method apps/tests call.** Document the final names in `LOGS.md` when implemented — if Store’s shape API forces `log.append` + custom `logQuery`, keep public sketches using those real names and update this plan in the same PR.

### Apply at registration builders

```ts
// Process.store / QueueResource.store / CustomQueueResource.store / RunResource.store
export function store(tag: StoreScopeTag, extended?: StoreShapes) {
  const builtIn = withImplicitLogShapes(
    makeProcessStoreAnalyticsContract(tag),
    tag.key,
  );
  return extended === undefined
    ? facetStoreRegistration(tag, builtIn)
    : facetStoreRegistration(tag, builtIn, extended);
}
```

### Node registration helper

```ts
// src/Logs.ts (public)
export const registerNode = <N extends NodeLogKeySource>(
  node: N,
): NormalizedStoreRegistration =>
  Store.register(resolveNodeLogKey(node), nodeLogContract(resolveNodeLogKey(node)));

// nodeLogContract ≈ today’s builtInLogStoreContract, but:
// - scopeKey = node key
// - follower match = all lines (stamp annotations.node on append)
// - same appendLog / logQuery surface as resources
```

**Done when:** a `Store.Service` that includes `Process.store(tag)` materializes handles with log write/query methods; unit test appends a row and reads it back **without** any follower yet (contract-only).

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
          yield* handle.appendLog.append(annotateNodeIfNeeded(reg, row.entry));
          // entryId: prefer including in row schema / journal id strategy used by Store.append
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
| Forbidden | Running interim `Logs.persistLayer` → `LogStore` **and** `Logs.registerNode` on the same node key in one process — two writers for the **same** scope. Migration: pick one. Compat tests cover wrapper-only or registerNode-only. |

**Done when:** `test/logs-follower.test.ts` covers match / memo / level gate (using today’s `Store.logLevel*` as `storeLevel`); resource-web or a focused example runs without `persistLayer`.

---

## Phase 3 — Shrink interim `LogStore` / `persistLayer` + wire readers

| Surface | During slice | After slice (docs) |
|---------|--------------|--------------------|
| `Logs.persistLayer` | Thin wrapper over `followRelayLayer` → `LogStore` | Deprecated; example migrate to `Logs.registerNode` on app store |
| `LogStore` class | Still exported for compat / tests | Prefer `registerNode` registration; deprecate in a later changeset if owner unlocks |
| `Logs.byNode` / `Resource.logs().query` | Prefer registration `logQuery` when `Storage` present; fall back to `LogStore.load` while compat lives | Document registration path as SSOT |
| `docs/LOGS.md` | Rewrite write-path diagram to followers | — |
| `examples/resource-web/server.ts` | Replace `persistLayer` + `LogStore.layerMemory` with app `Store.Service` that `registerNode`s + resource stores | — |

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
  Logs.registerNode(LiveNode),
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
4. **No double scope writer** — constructing both `persistLayer(node)` and `registerNode(node)` in one test runtime either fails fast or is documented as unsupported; preferred: test asserts registerNode-only path.

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
| **`followers-0`** | Shared `followRelayLayer` + `persistLayer` wrapper + lineId decision |
| **`followers-1`** | Implicit log shapes on `*.store(tag)` + `Logs.registerNode` |
| **`followers-2`** | Fork followers from store layer build + `test/logs-follower.test.ts` |
| **`followers-3`** | Example + `LOGS.md` + `Resource.logs`/`byNode` reader wiring + changeset |

Owner may unlock `followers-0` alone or `followers-0..2` as one PR if preferred.

---

## Owner unlock checklist

1. Accept this plan (or correct API names: `appendLog` vs `log.append`, `registerNode` vs `Node.logs` pipe).  
2. Confirm **node + resource both active** ⇒ two buckets (copies OK) vs nest resource writes under node only. Plan assumes **copies OK, memo per scope**.  
3. Confirm **`lineId`**: relay-assigned annotation (recommended) vs hash fallback.  
4. Unlock named slice: `followers-0` / `0–2` / `0–3`.  
5. Levels + remote remain parked until a later unlock.

**Stop — no code until unlock.**
