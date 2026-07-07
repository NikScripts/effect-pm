# Store guide

Shape-first scoped persistence for append/query rows — contracts, aggregates, and
**EventJournal-backed** layers.

> **Backing architecture:** [`store-backing.md`](./store-backing.md) — `EventJournal` +
> `SqlEventJournal`, not a custom SQL table.

## Quick start

```ts
import * as Store from "@nikscripts/effect-pm/Store";
import * as Schema from "effect/Schema";
import { Effect } from "effect";

const contract = Store.contract({
  readings: Store.shape(
    Schema.Struct({ value: Schema.Number }),
    Schema.Struct({ limit: Schema.optional(Schema.Number) }),
  ),
});

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Store.register("thermo", contract),
) {}

const program = Effect.gen(function* () {
  const store = yield* AppStore.at("thermo");
  yield* store.readings.append({ value: 72 });
  return yield* store.readings.read({ limit: 5 });
});
```

Provide a layer:

| Layer | Backing |
|-------|---------|
| `AppStore.layerMemory` | `EventJournal.layerMemory` |
| `AppStore.layer({ filename: "data.sqlite" })` | `SqliteClient` + `SqlEventJournal` |
| `AppStore.layer()` | Same as `layerMemory` |

## Contracts

### Part 1 — shapes

Each key in the shapes record becomes a namespace on the handle:

- `store.<shape>.append(payload)` — decode with the row schema, append one row (or an array batch).
- `store.<shape>.read(payload?)` — query appended rows; optional read payload schema (defaults to `{}`).

Use `Store.shape(rowSchema)` or `Store.shape(rowSchema, readPayloadSchema)` for explicit read filters.

### Part 2 — custom methods (optional)

```ts
const contract = Store.contract(
  { readings: readingSchema, audit: auditSchema },
  ({ readings, audit }) => ({
    listReadings: readings.read,
    snapshot: readings.read(),
    allNotes: Effect.gen(function* () {
      const rows = yield* audit.read();
      return rows.map((row) => row.note);
    }),
    recordAndCount: (n: number) =>
      Effect.gen(function* () {
        yield* readings.append({ value: n });
        return (yield* readings.read()).length;
      }),
  }),
);
```

Allowed in part 2: shape aliases, bare `Effect`s, effect functions. No `readWith` or ad-hoc query helpers.

### Extend

```ts
const extended = baseContract.pipe(
  Store.extend({ extra: extraSchema }),
  Store.extend((shapes) => ({ combined: shapes.extra.read })),
);
```

## Registration paths

| Form | Example | Bundle keys |
|------|---------|-------------|
| Tuple / rest | `Service(...)(reg1, reg2)` | `scopeKey` of each registration |
| Named object | `Service({ temp: reg })` | accessor name (`temp`) |
| Resource tag | `Resource.store(Tag, contract)` | tag `.key` |
| Run gate | `RunResource.store(Tag)` | tag `.key` (built-in fact + state contract) |
| String scope | `Store.register("scope", contract)` | `"scope"` |
| Standalone | `Store.store("scope", contract)` | yield `yield* MyStore` directly |

Resolve handles:

```ts
yield* AppStore.at(MyTag);
yield* AppStore.at("scope");
yield* MyTag.store;
```

## Persistence (`layer({ filename })`)

Durable storage uses Effect's **`SqlEventJournal`** on your SQLite file. Entries survive
reconnecting with a new scoped layer on the same path.

```ts
Effect.provide(program, AppStore.layer({ filename: ".effect-pm/data.sqlite" }));
```

## Retention

```ts
Store.retention(500)(Store.register("events", contract))
```

Oldest journal rows per `scopeKey` are deleted after each append when SQL is active.

## Default store (`layerDefaultMemory`)

Resource engines require `StoreScopeBridgeTag` in the environment.

**RunResource:** {@link RunResource.layer}, {@link RunResource.serve}, and {@link RunResource.Service.layer}
merge {@link Store.layerDefaultMemory} automatically via `Layer.provideMerge`. Override with a real
`AppStore.layerMemory` / `AppStore.layer({ filename })` at the app root — plain merge wins over the default.

**Process / Queue (until their cutover):** provide {@link Store.layerDefaultMemory} at the app root when you
do not compose a custom {@link Store.Service}:

```ts
import * as Store from "@nikscripts/effect-pm/Store";

const AppLayer = MyProcess.layer.pipe(Layer.provideMerge(Store.layerDefaultMemory));
```

**`RunResource.make`:** still an `Effect`, not a layer — provide {@link Store.layerDefaultMemory} on the
effect (see `test/run-resource.test.ts`).

Run gates register built-in fact/state shapes with {@link RunResource.store}:

```ts
class AppStore extends Store.Service<AppStore>("@app/Store")(
  RunResource.store(FetchGate),
) {}

const live = FetchGate.layer.pipe(Layer.provideMerge(AppStore.layerMemory));
const facts = yield* (yield* AppStore.at(FetchGate)).facts();
```

See [`examples/forms/resource/run-resource-store-readback.ts`](../../examples/forms/resource/run-resource-store-readback.ts).

## Change stream

```ts
const stream = yield* Store.changes("thermo");
```

Streams from `EventJournal.changes`, filtered to the scope.

## Engine authoring

Toolkit engines resolve store handles through **`Store.Storage`** — a defaulted service. Merge
`Store.layerDefaultMemory` into your layer (or let the app override with `Layer.provideMerge`).

```ts
import * as Store from "@nikscripts/effect-pm/Store";
import { Effect, Layer } from "effect";

// At layer build — declared dependency, never serviceOption
const program = Effect.gen(function* () {
  const store = yield* Store.withDefault(scopeKey, myContract);
  yield* store.record(row);
});

// Bake default into a custom resource layer
const myLayer = baseLayer.pipe(Layer.provideMerge(Store.layerDefaultMemory));

// Low-level (when you need the bridge directly)
Effect.gen(function* () {
  const bridge = yield* Store.Storage;
  const store = yield* bridge.at(scopeKey, contract);
});
```

| API | Use when |
|-----|----------|
| `Store.withDefault` | Always record — default store materializes the scope |
| `Store.withStorage` | Opt-in — fails `StoreScopeNotRegistered` if scope not registered |
| `Store.Storage` | Custom engine plumbing; same bridge app stores provide |
| `Store.layerDefaultMemory` | Toolkit layer merge — Process / Queue pattern |

## Examples

- `examples/forms/store/store-memory.ts`
- `examples/forms/store/store-sqlite.ts`

## Related

- [`store-backing.md`](./store-backing.md) — EventJournal architecture (read this)
- [`../handoffs/store-and-logs-design.md`](../handoffs/store-and-logs-design.md)
