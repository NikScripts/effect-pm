# Store guide

Shape-first scoped persistence for append/query rows — **contracts**, **shapes** (flat or nested),
typed **handles**, and a transform layer for turning a contract into a set of ready-to-record
**effects**. Backed by Effect's `EventJournal`.

> **Backing architecture:** [`store-backing.md`](./store-backing.md) — `EventJournal` +
> `SqlEventJournal`, not a custom SQL table.
> **Coming from the old tap/bridge pattern?** [`store-migration.md`](./store-migration.md).

## Mental model

1. A **contract** (`Store.contract`) declares named **shapes** — each a row schema plus an optional
   read-query schema — and optional **custom methods**.
2. A shape becomes `store.<shape>.append` / `store.<shape>.read` on the resolved **handle**.
3. You resolve a handle three ways — `MyStore.at(scope)`, `tag.store`, or the standalone class — or
   you skip the handle entirely and get a pure **effects object** (`Store.effects`) whose every method
   already carries its `Storage` requirement. Transforms (`mapEffects` / `catchWriteErrors`) refine
   that effects object.

## Quick start

```ts
import * as Store from "@nikscripts/effect-pm/Store";
import * as Schema from "effect/Schema";
import { Effect } from "effect";

const contract = Store.contract({
  readings: Store.shape(Schema.Struct({ value: Schema.Number })),
});

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Store.register("thermometer", contract),
) {}

const program = Effect.gen(function* () {
  const store = yield* AppStore.at("thermometer");
  yield* store.readings.append({ value: 72 });
  return yield* store.readings.read({ limit: 5 });
});

Effect.provide(program, AppStore.layerMemory);
```

| Layer | Backing |
|-------|---------|
| `AppStore.layerMemory` | `EventJournal.layerMemory` (process-local) |
| `AppStore.layer({ filename: "data.sqlite" })` | `SqliteClient` + `SqlEventJournal` |
| `AppStore.layer()` | Same as `layerMemory` |

## Contracts + shapes

### Part 1 — shapes

Each key in the shapes record becomes a namespace on the handle:

- `store.<shape>.append(payload)` — decode with the row schema, append one row (or an array batch —
  the payload is `row | ReadonlyArray<row>`).
- `store.<shape>.read(payload?)` — query appended rows with the **baked-in** read payload
  (`limit` / `before` / `after` / nested Drizzle-RQB `where`).

A shape value may be:

- a bare `Schema.Schema` — row schema;
- `Store.shape(row)` — same, explicit;
- a **nested record** of the above — see below.

### Nested shapes

Shapes nest: a record value groups sub-shapes under a namespace, and the handle mirrors the tree.

```ts
const contract = Store.contract(
  {
    sensors: {
      temperature: Schema.Struct({ celsius: Schema.Number }),
      humidity: Schema.Struct({ percent: Schema.Number }),
    },
    alerts: Schema.Struct({ message: Schema.String }),
  },
  ({ sensors, alerts }) => ({
    // Part-2 aliases navigate the nested tree — `sensors.temperature.append` is a real sub-handle.
    recordTemp: sensors.temperature.append,
    latestTemp: sensors.temperature.read,
    recordAlert: alerts.append,
  }),
);
```

The resolved handle is nested for real:

```ts
yield* store.sensors.temperature.append({ celsius: 21 });   // Effect<void, StoreWriteError, …>
yield* store.sensors.humidity.append({ percent: 40 });
yield* store.alerts.append({ message: "hot" });             // flat leaf, top level
const temps = yield* store.sensors.temperature.read();
```

> The type-level proof of nested resolution (handle tree, ref tree, `changes` selector inference) is
> `test/store-shape-streams.test-d.ts`. Reference it when you extend the shape model.

### Part 2 — custom methods (optional)

```ts
const contract = Store.contract(
  { readings: readingSchema, audit: auditSchema },
  ({ readings, audit }) => ({
    listReadings: readings.read,
    snapshot: readings.read(),
    allNotes: Effect.map(audit.read(), (rows) => rows.map((row) => row.note)),
    recordAndCount: (n: number) =>
      Effect.flatMap(readings.append({ value: n }), () =>
        Effect.map(readings.read(), (rows) => rows.length),
      ),
  }),
);
```

Allowed in part 2: shape aliases (flat or nested), bare `Effect`s, effect functions. No `readWith` or
ad-hoc query helpers.

### Extend — `Store.extend` (the tier primitive)

`Store.extend` is the composable counterpart to `Store.contract`: a base is built once with `contract`,
and each **tier** on top of it is an `extend` — more shapes, more custom methods, or both. This is how
you stack contracts; you never rebuild a base with `contract` to add a tier.

```ts
const extended = baseContract.pipe(
  Store.extend({ extra: extraSchema }),
  Store.extend((shapes) => ({ combined: shapes.extra.read })),
);
```

**Concrete-preservation.** Prefer the **data-first** form `Store.extend(methodsFn, base)` when the methods
read the base's shapes. Fed the `base` alongside its methods builder, `extend` infers each method's exact
return type and merges it as `base.custom & …`, so the concrete method signatures survive all the way onto
`Store.effects` — never a widened `Record<string, unknown>`. The builder receives the base's shape handles,
so `event.append` / `event.read` are typed for the base's own row schemas.

```ts
const base = Store.contract({ event: eventSchema }, ({ event }) => ({
  record: event.append,
  events: event.read,
}));

const engine = Store.extend(
  ({ event }) => ({
    completed: (entry: Entry, success: Success, elapsed: Duration.Duration) =>
      event.append({ _tag: "Completed", entry, success, elapsed }),
  }),
  base,
);
// engine.custom.completed keeps its exact (entry, success, elapsed) => Effect<void, StoreWriteError> type
```

This is how the queue stacks its three tiers — lean base (`contract`) → engine write-extension (`extend`) →
analytics read-extension (`extend`); see [`queue-resource.md`](./queue-resource.md).

## Resolving a handle — `resolve` / `resolveOrDie`

Two façades collapse the `flatMap(Storage, (bridge) => bridge.at(scope, contract))` plumbing. They
replace the former `withStorage` / `withDefault` (removed — no aliases).

```ts
// Opt-in: fails StoreScopeNotRegistered if the provided storage doesn't carry this scope.
const handle = yield* Store.resolve("thermometer", contract);
//    Effect<Handle, StoreScopeNotRegistered, Storage>

// Always-on: hardened with orDie — with the baked-in in-memory default in context it never fails.
const handle = yield* Store.resolveOrDie("thermometer", contract);
//    Effect<Handle, never, Storage>
```

Use `resolve` when persistence is optional (record **only if** the app wired durable storage). Use
`resolveOrDie` on the always-on observability path — a resource's engine records unconditionally, and
the baked-in default materializes any scope on demand, so it can't fail. (If a *custom* store is in
context and lacks the scope, `resolveOrDie` dies with a clear message: bake the default.)

The higher-level lookups (`MyStore.at(tag)`, `tag.store`) resolve through the same bridge.

## `Store.effects` — the requirement rides on each effect

`Store.effects(scope, contract)` builds a **pure object of effects** shaped exactly like the handle
(nested tree + custom methods), but where every method is a thunk that resolves the handle lazily and
runs. The key property: **`Storage` rides on every method's requirement channel** — there is no
`yield*`, no memo cell, no up-front resolution in your code.

```ts
const store = Store.effects("sensors", sensorContract);
yield* store.sensors.temperature.append({ celsius: 21 }); // Effect<void, StoreWriteError, Storage>
const rows = yield* store.sensors.temperature.read();     // Effect<ReadonlyArray<…>, never, Storage>
```

Why this matters: a resource **engine** can hold `store` as a plain value, hand its narrow writes to
the worker loop, and provide `Storage` once at the boundary — the requirement flows through the type
system per method rather than forcing an eager resolve. This is the foundation the golden queue
builds on (see [`queue-resource.md`](./queue-resource.md)).

Honest error typing:

- **Write** methods (`append`, and any custom write) carry `StoreWriteError` in `E` — a journal/IO
  write can genuinely fail.
- **Read** methods carry no error (`never`).
- `resolveOrDie` under the hood means an unregistered *custom* store is a **defect**, not a
  `StoreScopeNotRegistered` failure — so the error channel stays about real write failures only.

## The transform layer — `mapEffects`

`Store.mapEffects(effects, transform)` is the generic combinator: it walks **every** method on an
effects object (nested leaves + custom), passes each returned `Effect` through `transform`, then
re-nests and re-brands. Any Effect combinator works.

```ts
// Trace every store method.
const traced = Store.mapEffects(store, (effect) => Effect.withSpan(effect, "store"));

// Retry every store method.
const resilient = Store.mapEffects(store, (effect) => Effect.retry(effect, retryPolicy));

// Time every store method.
const timed = Store.mapEffects(store, (effect) => Effect.timed(effect));
```

Type-preserving transforms (`withSpan` / `retry` / `timed`, all `Effect<A,E,R> → Effect<A,E,R>`) leave
the effects type unchanged. A **type-changing** transform (narrowing `E`) supplies an explicit per-method
result — that's exactly how `catchWriteErrors` is built.

## `catchWriteErrors` — swallow write failures

`Store.catchWriteErrors(effects)` is a one-liner over `mapEffects`: catch `StoreWriteError`, log it at
warning level, and succeed as `void` — so `StoreWriteError` is **narrowed out** of every write method's
error channel. A fire-and-forget observability append that hits a journal hiccup logs and moves on
instead of breaking the caller.

```ts
import { Effect } from "effect";

const guarded = Store.effects("sensors", sensorContract).pipe(Store.catchWriteErrors);
yield* guarded.sensors.temperature.append({ celsius: 21 }); // Effect<void, never, Storage>
```

Precise scope of the guard:

| Case | Behavior |
|------|----------|
| **Write failure** (`StoreWriteError`) | Caught, logged (`logWarning`), succeeds as `void`; removed from `E`. |
| **Encode / serialization mismatch** | A **defect** (`orDie` in the append path — the value doesn't fit the shape, a bug). **Not** swallowed. |
| **Wiring die** (no store, custom store missing scope) | A **defect**. **Not** swallowed. |
| **Reads and every other error** | Untouched — `Exclude<E, StoreWriteError>` is a no-op where absent. |

This is why `StoreWriteError` **carries** its category: the storage layer's append path maps a genuine
journal/IO write failure to `StoreWriteError`, while the **encode** step stays `Effect.orDie` (a schema
mismatch is a bug → defect). No method needs to be marked "a write" — the error type says so, and
`catchWriteErrors` acts on exactly that.

## Multi-engine store specs (queue family)

`QueueResource` and `CustomQueueResource` share one queue engine (`buildQueueEngine` /
`publishEvent`). Persistence uses the same three-tier model:

1. **Tier 1 (lean base)** — `record` / `events` over `QueueEvent<T>`.
2. **Tier 2 (engine writes)** — narrow semantic writes (`enqueued`, `started`, `completed`, …) via
   `Store.extend`, materialized with `materializeEngineQueueStoreForTag` (toolkit tags) or
   `materializeEngineQueueStoreForItem` (schema-first: `CustomQueueResource.make`, no tag).
3. **Tier 3 (analytics reads)** — `QueueResource.store(tag)` / `CustomQueueResource.store(tag)` —
   pure derivations over `events`; no engine narrow writes on the public registration.

Toolkit `layer` / `serve` / `serveRemote` merge `Store.layerDefaultMemory` and wire tier 2 at build
time. Custom queues use `void` / `unknown` wire slots (no `success` / `error` on the tag).

## Registration paths

| Form | Example | Bundle keys |
|------|---------|-------------|
| Tuple / rest | `Service(...)(reg1, reg2)` | `scopeKey` of each registration |
| Named object | `Service({ temp: reg })` | accessor name (`temp`) |
| Resource tag | `Resource.store(Tag, contract)` | tag `.key` |
| Queue tag | `QueueResource.store(Tag)` | tag `.key` (built-in analytics contract) |
| Custom queue tag | `CustomQueueResource.store(Tag)` | tag `.key` (same analytics contract; shared `QueueEvent<T>`) |
| Run gate | `RunResource.store(Tag)` | tag `.key` |
| String scope | `Store.register("scope", contract)` | `"scope"` |
| Standalone | `Store.store("scope", contract)` | `yield* MyStore` directly |

Resolve handles:

```ts
yield* AppStore.at(MyTag);
yield* AppStore.at("scope");
yield* MyTag.store;
```

## Change stream — `Store.changes`

Three forms, from coarse to typed:

```ts
// Coarse firehose of StoreChangeEvent for a scope (string or tag).
const events = yield* Store.changes("thermometer");

// Decoded rows of EVERY shape on the store (discriminated union).
const all = yield* Store.changes(SensorStore);

// Decoded rows of the ONE shape the selector navigates to (selector-driven inference).
const temps = yield* Store.changes(SensorStore, (s) => s.sensors.temperature);
```

All three stream from `EventJournal.changes`, filtered to the scope. Requires a `layer` /
`layerMemory` that installed the scope bridge.

## Retention + log level

```ts
Store.register("events", contract).pipe(Store.retention(500))   // trim oldest rows after each append
Store.register("events", contract).pipe(Store.logLevelWarn)     // durable log-export level
```

## Examples

- `examples/forms/store/store-memory.ts`
- `examples/forms/store/store-sqlite.ts`

## Related

- [`store-backing.md`](./store-backing.md) — EventJournal architecture + `StoreWriteError` semantics
- [`store-migration.md`](./store-migration.md) — old tap/bridge → the new machinery
- [`queue-resource.md`](./queue-resource.md) — the golden three-tier example
- [`../handoffs/store-and-logs-design.md`](../handoffs/store-and-logs-design.md)
