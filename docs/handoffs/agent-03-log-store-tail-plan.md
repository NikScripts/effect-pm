# Agent 3 — Durable log store tail (Effect-true redesign)

**Branch:** `cursor/logs-store-followers-906e`  
**Bar:** Effect v4 headliner quality — pipe-first, `Filter`/`Predicate`, one Stream, no ad-hoc Queue loops, no public junk names.

`persistLayer` / `LogStore` stay until a later revisit.

---

## Design thesis

A durable store tail is **a Stream pipeline over `LogRelay`**, not a mini actor with two fibers and a hand-managed queue.

```
LogRelay.stream
  |> filter(policy)          // level ∧ match — pure Predicate
  |> filterEffect(claimId)   // memo (scopeKey, lineId) — HashSet
  |> groupedWithin(64, 250ms)
  |> mapEffect(appendBatch)  // handle.log.append
  |> runDrain                // one scoped fiber
```

Policy is data. Dedupe is an effectful filter. The Layer only acquires that drain in a Scope.

---

## 1. Pure policy (no Effects)

```ts
// src/internal/logs/durableTailPolicy.ts
import { LogLevel, Predicate } from "effect"
import type { LogEntry } from "../../LogEntry"
import type { StoreLogLevel } from "../store/types"

/** Store export floor → Effect LogLevel gate. "All"/"None" are store vocabulary. */
export const meetsStoreLevel =
  (floor: StoreLogLevel): Predicate.Predicate<LogEntry> => {
    if (floor === "All") return Predicate.constTrue
    if (floor === "None") return Predicate.constFalse
    return (entry) => LogLevel.isGreaterThanOrEqualTo(entry.level, floor)
  }

export const durableTailPolicy = (options: {
  readonly storeLevel: StoreLogLevel
  readonly match: Predicate.Predicate<LogEntry>
}): Predicate.Predicate<LogEntry> =>
  Predicate.and(meetsStoreLevel(options.storeLevel), options.match)
```

Resource registration: `match = LogEntry.hasKey(scopeKey)`.  
Node registration: `match = Predicate.constTrue` (or `LogEntry.atRoot(nodeKey)` once lineage is solid).

---

## 2. Line identity + claim (dedupe)

```ts
// src/internal/logs/lineId.ts
import type { LogEntry } from "../../LogEntry"
import { LogAnnotationKeys } from "../../LogContext"

export type LineId = string & { readonly _tag: "LineId" }

export const lineIdFromEntry = (entry: LogEntry): LineId => {
  const stamped = entry.annotations[LogAnnotationKeys.lineId] // add key if missing
  if (stamped !== undefined) return stamped as LineId
  // transitional fallback — prefer stamping at capture in same PR
  return `${entry.date}\0${entry.level}\0${entry.message}\0${entry.annotations[LogAnnotationKeys.lineage] ?? ""}` as LineId
}
```

```ts
// claim: first observer for (scope, id) wins
import { Effect, HashSet, Ref } from "effect"

export const makeLineIdClaim = (scopeKey: string) =>
  Effect.map(Ref.make(HashSet.empty<LineId>()), (seen) =>
    (id: LineId): Effect.Effect<boolean> =>
      Ref.modify(seen, (set) =>
        HashSet.has(set, id)
          ? [false, set] as const
          : [true, HashSet.add(set, id)] as const,
      ),
  )
```

Stream side:

```ts
Stream.filterEffect((entry) => claim(lineIdFromEntry(entry)))
```

---

## 3. The pipeline (one fiber)

```ts
// src/internal/logs/durableTail.ts
import { Duration, Effect, Layer, Stream } from "effect"
import type { Predicate } from "effect/Predicate"
import type { LogEntry } from "../../LogEntry"
import type { StoreLogLevel } from "../store/types"
import { LogRelay } from "./relay"
import { durableTailPolicy } from "./durableTailPolicy"
import { lineIdFromEntry, makeLineIdClaim } from "./lineId"

export interface DurableTail {
  readonly scopeKey: string
  readonly storeLevel: StoreLogLevel
  readonly match: Predicate.Predicate<LogEntry>
  readonly append: (entry: LogEntry) => Effect.Effect<void>
  readonly batchSize?: number
  readonly batchWindow?: Duration.Input
}

const runDurableTail = (relay: LogRelay["Service"], options: DurableTail) =>
  Effect.gen(function* () {
    const claim = yield* makeLineIdClaim(options.scopeKey)
    const policy = durableTailPolicy(options)
    const batchSize = options.batchSize ?? 64
    const batchWindow = options.batchWindow ?? "250 millis"

    yield* relay.stream.pipe(
      Stream.filter(policy),
      Stream.filterEffect((entry) => claim(lineIdFromEntry(entry))),
      Stream.groupedWithin(batchSize, batchWindow),
      Stream.mapEffect((batch) =>
        Effect.forEach(batch, options.append, { concurrency: 1, discard: true }),
      ),
      Stream.runDrain,
    )
  })

/**
 * Forks the durable tail in the layer Scope. Requires LogRelay.
 * Prefer this over a second capture logger — subscribe only.
 */
export const layer = (options: DurableTail): Layer.Layer<never, never, LogRelay> =>
  Layer.effectDiscard(
    Effect.flatMap(LogRelay, (relay) =>
      Effect.forkScoped(runDurableTail(relay, options)).pipe(Effect.asVoid),
    ),
  )

/** Store builds whether or not Logs.layer is present. */
export const layerOptional = (options: DurableTail): Layer.Layer<never> =>
  Layer.unwrap(
    Effect.map(Effect.serviceOption(LogRelay), (opt) =>
      opt._tag === "Some" ? layer(options) : Layer.empty,
    ),
  )
```

Notes vs the earlier sketch:

| Before (weak) | After (Effect-true) |
|---------------|---------------------|
| Two fibers + `Queue.unbounded` | One `runDrain` on a composed Stream |
| `Set` + copy-on-write | `HashSet` + `Ref.modify` claim |
| Manual level ordinal table | `LogLevel.isGreaterThanOrEqualTo` |
| Nested `Effect.gen` in `runForEach` | `Stream.filter` / `filterEffect` / `mapEffect` |
| Invented public name | Internal `durableTail.layer` only |

---

## 4. Implicit `log` shape (unchanged product)

```ts
// src/internal/store/logShapes.ts
export const withImplicitLogShape = <C extends StoreContractValue>(contract: C) =>
  Store.extend(contract, {
    log: Store.shape(LogEntrySchema),
  })
```

Toolkit `*.store(tag)` wraps built-ins. Node: `Resource.store(node)` / `Node.logs` → same shape.

---

## 5. Store layer wiring (composition, not casts)

```ts
// after bridge + bundle exist
const logTails = registrations.flatMap((reg) => {
  if (!hasLogShape(reg.contract)) return []

  const handle = bundleHandleFor(reg) // typed path from buildBundle — exposes .log.append
  const match = isNodeRegistration(reg)
    ? Predicate.constTrue
    : LogEntry.hasKey(reg.scopeKey)

  return [
    durableTail.layerOptional({
      scopeKey: reg.scopeKey,
      storeLevel: reg.logLevel ?? "All",
      match,
      append: (entry) => handle.log.append(entry).pipe(Effect.orDie),
    }),
  ]
})

return Layer.mergeAll(layerFromBuiltBridge(...), ...logTails)
```

Typing goal: no `as { log: … }` — extend registration/contract types so `hasLogShape` narrows to a handle with `log.append`.

---

## 6. Capture stamp (same PR if cheap)

In `captureLogger` / `logEntryFromLoggerOptions`, assign monotonic `lineId` onto annotations once per published line so every store tail memos the same token. Fallback hash remains for old rows.

---

## 7. Tests (Exit / `_tag`, TestClock)

```ts
it.effect("resource tail is lineage-scoped", () =>
  Effect.gen(function* () {
    // Logs.layer + AppStore[Process.store(A), Process.store(B)]
    yield* Effect.log("a").pipe(Effect.provide(Logs.withScope(A)))
    yield* Effect.log("b").pipe(Effect.provide(Logs.withScope(B)))
    yield* TestClock.adjust("300 millis")

    const rows = yield* (yield* AppStore.at(A)).log.read()
    assert.ok(rows.every(LogEntry.hasKey(A.key)))
  }),
)
```

Also: memo once; Warn floor drops Info; no LogRelay → store builds, empty `log.read`.

---

## 8. Commit sequence

1. `lineId` + capture stamp  
2. `durableTailPolicy` + `durableTail.layer` (+ unit Stream tests)  
3. `withImplicitLogShape` on toolkit stores  
4. Store layer merge of `layerOptional`  
5. Integration tests + changeset  

Branch: `cursor/logs-store-followers-906e`. Frequent commits/pushes. Merge to `integration` only on your say.

---

## Open (owner)

1. Node + resource both tailing → two copies OK?  
2. Ship capture `lineId` stamp in this PR?  
3. `Resource.store(Node)` in this PR or sugar follow-up?
