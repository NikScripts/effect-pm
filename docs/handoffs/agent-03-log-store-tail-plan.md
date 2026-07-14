# Agent 3 — Log store durable tail — code plan

**Branch:** `cursor/logs-store-followers-906e`  
**Status:** code plan for owner review — implement after accept.

---

## 1. Implicit `log` shape on every registration

```ts
// src/internal/store/logShapes.ts  (NEW)

import { Schema } from "effect";
import { LogEntrySchema } from "../../LogEntry";
import * as Store from "../../Store";
import type { StoreContractValue } from "./contractDef";

export const withImplicitLogShape = <C extends StoreContractValue>(contract: C) =>
  Store.extend(contract, {
    log: Store.shape(LogEntrySchema),
  });
```

```ts
// Process.store / QueueResource.store / … — wrap built-in contract

export function store(tag: StoreScopeTag, extended?: StoreShapes) {
  const builtIn = withImplicitLogShape(makeProcessStoreAnalyticsContract(tag));
  return extended === undefined
    ? facetStoreRegistration(tag, builtIn)
    : facetStoreRegistration(tag, builtIn, extended);
}
```

Node (v1 sketch — same shape):

```ts
// Resource.store(WnbaNode) or WnbaNode.logs → Store.register(node.key, nodeLogContract)

const nodeLogContract = Store.contract({
  log: Store.shape(LogEntrySchema),
});
```

Handle after materialize:

```ts
yield* handle.log.append(entry);
yield* handle.log.read({ limit: 50, where: { level: { in: ["Warn", "Error"] } } });
```

---

## 2. Durable tail — generalize `storeFollower.ts`

Replace the LogStore-only body with a private factory. **Not exported from `Logs`.**

```ts
// src/internal/logs/storeFollower.ts

import {
  Context,
  Duration,
  Effect,
  Layer,
  LogLevel,
  Option,
  Queue,
  Ref,
  Stream,
} from "effect";
import type { Predicate } from "effect/Predicate";
import type { LogEntry } from "../../LogEntry";
import type { StoreLogLevel } from "../store/types";
import { LogRelay } from "./relay";

export interface DurableLogTailOptions {
  readonly scopeKey: string;
  readonly match: Predicate.Predicate<LogEntry>;
  readonly storeLevel: StoreLogLevel;
  /** Closed over the registration handle — e.g. `(e) => handle.log.append(e)`. */
  readonly append: (entry: LogEntry) => Effect.Effect<void, never>;
  readonly batchSize?: number;
  readonly batchWindow?: Duration.DurationInput;
}

const levelRank: Record<StoreLogLevel, number> = {
  All: Number.NEGATIVE_INFINITY,
  Debug: LogLevel.getOrdinal("Debug"),
  Info: LogLevel.getOrdinal("Info"),
  Warn: LogLevel.getOrdinal("Warn"),
  Error: LogLevel.getOrdinal("Error"),
  None: Number.POSITIVE_INFINITY,
};

const allowsLevel = (min: StoreLogLevel, entry: LogEntry): boolean => {
  if (min === "All") return true;
  if (min === "None") return false;
  return LogLevel.getOrdinal(entry.level) >= levelRank[min];
};

const lineIdOf = (entry: LogEntry): string => {
  const stamped = entry.annotations["@nikscripts/effect-pm/lineId"];
  if (stamped !== undefined) return stamped;
  // fallback until capture stamps lineId
  return `${entry.date}|${entry.level}|${entry.message}|${entry.annotations["@nikscripts/effect-pm/lineage"] ?? ""}`;
};

/**
 * Scoped layer: fork a bus subscriber that durable-appends matching lines.
 * Requires LogRelay. Provides nothing.
 *
 * @internal
 */
export const durableLogTailLayer = (
  options: DurableLogTailOptions,
): Layer.Layer<never, never, LogRelay> =>
  Layer.scopedDiscard(
    Effect.gen(function* () {
      const relay = yield* LogRelay;
      const seen = yield* Ref.make(new Set<string>());
      const queue = yield* Queue.unbounded<LogEntry>();

      yield* Effect.forkScoped(
        relay.stream.pipe(
          Stream.runForEach((entry) =>
            Effect.gen(function* () {
              if (!allowsLevel(options.storeLevel, entry)) return;
              if (!options.match(entry)) return;
              const id = lineIdOf(entry);
              const already = yield* Ref.get(seen);
              if (already.has(id)) return;
              yield* Ref.update(seen, (s) => new Set([...s, id]));
              yield* Queue.offer(queue, entry);
            }),
          ),
        ),
      );

      yield* Effect.forkScoped(
        Stream.runForEach(
          Stream.groupedWithin(
            Stream.fromQueue(queue),
            options.batchSize ?? 64,
            Duration.decode(options.batchWindow ?? Duration.millis(250)),
          ),
          (batch) =>
            Effect.forEach(batch, (entry) => options.append(entry), {
              concurrency: 1,
              discard: true,
            }),
        ),
      );
    }),
  );

/** Optional: if LogRelay missing, skip (store still builds). @internal */
export const durableLogTailLayerOptional = (
  options: DurableLogTailOptions,
): Layer.Layer<never> =>
  Layer.unwrap(
    Effect.map(Effect.serviceOption(LogRelay), (opt) =>
      Option.isSome(opt) ? durableLogTailLayer(options) : Layer.empty,
    ),
  );
```

`Logs.persistLayer` **unchanged this slice** (still the old LogStore writer). Revisit later.

---

## 3. Wire tails when the store layer builds

Hook after handles exist in aggregate (and standalone) layer builders:

```ts
// src/Store.ts — inside layerFromScopeState (sketch)

import * as LogEntry from "./LogEntry";
import { durableLogTailLayerOptional } from "./internal/logs/storeFollower";

const layerFromScopeState = (tag, registrations, scopes) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const journal = yield* EventJournal.EventJournal;
      const bridge = buildScopeBridge(scopes, journal);
      const bundle = yield* buildBundle(registrations, bridge.at).pipe(Effect.orDie);

      const storeServices = layerFromBuiltBridge(tag, bundle, bridge);

      // One durable tail per registration that has a `log` shape
      const tails = yield* Effect.forEach(registrations, (reg) =>
        Effect.gen(function* () {
          if (!contractHasLogShape(reg.contract)) return Layer.empty;

          const handle = yield* Effect.promise(() =>
            // same path buildBundle used — typed handle with .log.append
            bridge.at(reg.scopeKey, reg.contract),
          );

          const append = (entry: LogEntry.LogEntry) =>
            (handle as { log: { append: (e: LogEntry.LogEntry) => Effect.Effect<void> } })
              .log.append(entry)
              .pipe(Effect.orDie);

          return durableLogTailLayerOptional({
            scopeKey: reg.scopeKey,
            match: isNodeScope(reg)
              ? () => true
              : LogEntry.hasKey(reg.scopeKey),
            storeLevel: reg.logLevel ?? "All",
            append,
          });
        }),
      );

      return Layer.mergeAll(storeServices, ...tails);
    }),
  );
```

Same pattern on standalone single-registration `buildStandaloneMemoryLayer`.

App composition (requirement):

```ts
AppStore.layerMemory.pipe(Layer.provide(Logs.layer))
// or provideMerge — LogRelay must be available when store layer builds
```

---

## 4. End-to-end app picture

```ts
class AppStore extends Store.Service<AppStore>()("@app/Store")([
  Resource.store(WnbaNode),
  Process.store(LiveScorePoller),
]) {}

const live = Resource.httpServer([
  processEntry(LiveScorePoller, { /* … */ }),
]).pipe(
  Layer.provide(Logs.layer),
  Layer.provide(AppStore.layerMemory),
);

// After LiveScorePoller logs "tick":
const { log } = yield* AppStore.at(LiveScorePoller);
const rows = yield* log.read({ limit: 20 });
// rows only include lines whose lineage has LiveScorePoller.key

const node = yield* AppStore.at(WnbaNode);
const all = yield* node.log.read({ limit: 200 });
// all lines on this runtime (if node match = everything)
```

---

## 5. Tests (`test/logs-follower.test.ts`)

```ts
it.effect("resource tail only appends matching lineage", () =>
  Effect.gen(function* () {
    // provide Logs.layer + AppStore with Process.store(TagA) + Process.store(TagB)
    yield* Effect.logInfo("from A").pipe(Effect.provide(Logs.withScope(TagA)));
    yield* Effect.logInfo("from B").pipe(Effect.provide(Logs.withScope(TagB)));
    // drain batch window
    yield* TestClock.adjust("300 millis");

    const a = yield* AppStore.at(TagA);
    const rows = yield* a.log.read();
    assert.ok(rows.every(LogEntry.hasKey(TagA.key)));
  }),
);

it.effect("memo: same lineId once per scope", () => { /* republish same id */ });
it.effect("Store.logLevelWarn drops Info", () => { /* … */ });
```

---

## 6. Commit sequence on this branch

1. `withImplicitLogShape` + wire into `*.store(tag)` + type/tests for `handle.log`  
2. `durableLogTailLayer` in `storeFollower.ts` (+ lineId helper)  
3. Store layer merge of tails  
4. Follower tests + changeset  

Frequent commits/pushes on `cursor/logs-store-followers-906e`. Merge to `integration` only when you say so.

---

## Still need from you

1. Node + resource both tailing → **two copies OK?**  
2. Prefer **relay-stamped `lineId`** in the same PR?  
3. Ship **`Resource.store(Node)`** in this PR or sugar-only later?
