{#stores title="Stores" status="draft" done="api" appliesTo=all}
# Stores

{.draft}
**Draft** — ported from the pre-site corpus; tip-check before treating as SSOT.

Shape-first scoped persistence for append/query rows — **contracts**, **shapes** (flat or nested),
typed **handles**, and a transform layer for turning a contract into ready-to-record **effects**.
Backed by Effect’s `EventJournal` (memory or SQLite via `SqlEventJournal`) — not a custom row table.

Agent-facing persistence rules and cutover history stay in
[`docs/legacy/STORAGE.md`](https://github.com/NikScripts/effect-pm/blob/integration/docs/legacy/STORAGE.md)
for now. Durable **logs** are a separate chapter: [Logs](/docs/logs).

## Mental model

1. A **contract** (`Store.contract`) declares named **shapes** — each a row schema — and optional
   **custom methods**.
2. A shape becomes `store.<shape>.append` / `store.<shape>.read` on the resolved **handle**.
3. Resolve a handle with `MyStore.at(scope)`, `tag.store`, or skip the handle and use
   `Store.effects` whose every method already carries its `Storage` requirement.

## Quick start

``` ts
import * as Store from "@nikscripts/effect-pm/Store"
import { Effect, Schema } from "effect"

const contract = Store.contract({
  readings: Store.shape(Schema.Struct({ value: Schema.Number })),
})

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Store.register("thermometer", contract),
) {}

const program = Effect.gen(function* () {
  const store = yield* AppStore.at("thermometer")
  yield* store.readings.append({ value: 72 })
  return yield* store.readings.read({ limit: 5 })
})

Effect.provide(program, AppStore.layerMemory)
```

| Layer | Backing |
|-------|---------|
| `AppStore.layerMemory` | `EventJournal.layerMemory` (process-local) |
| `AppStore.layer({ filename: "data.sqlite" })` | `SqliteClient` + `SqlEventJournal` |
| `AppStore.layer()` | Same as `layerMemory` |

Toolkit engines (Process, Queue, …) merge `Store.layerDefaultMemory` so observability always has a
store; override at the root with your app `Store.Service` layer.

## Contracts + shapes

Each key in the shapes record becomes a namespace on the handle:

- `store.<shape>.append(payload)` — decode with the row schema, append one row (or an array batch —
  the payload is `row | ReadonlyArray<row>`).
- `store.<shape>.read(payload?)` — query appended rows (`limit` / `before` / `after` / nested where).

A shape value may be a bare schema, `Store.shape(row)`, or a **nested record** of those — the handle
mirrors the tree:

``` ts
const contract = Store.contract({
  sensors: {
    temperature: Schema.Struct({ celsius: Schema.Number }),
    humidity: Schema.Struct({ percent: Schema.Number }),
  },
  alerts: Schema.Struct({ message: Schema.String }),
})
```

### Custom methods + `Store.extend`

Optional part 2 of `Store.contract` aliases shape methods or builds derived Effects. Prefer
`Store.extend` to stack **tiers** on a base contract rather than rebuilding it — the queue’s lean
base → engine writes → analytics reads is the model ([Queues](/docs/queues)).

## `Store.effects` + transforms

`Store.effects(scope, contract)` builds a pure object of effects shaped like the handle; **`Storage`
rides on every method’s requirement**. Engines hold that object and provide `Storage` once at the
boundary.

`Store.mapEffects` walks every method and pipes each returned Effect through a transform.
`Store.catchWriteErrors` is the common one-liner: catch `StoreWriteError`, log a warning, succeed as
`void` — encode/wiring defects are **not** swallowed.

## Backing (EventJournal)

| Journal field | Store meaning |
|---------------|---------------|
| `primaryKey` | Registration `scopeKey` (tag `.key` or string scope) |
| `event` | Shape / append method name |
| `payload` | Encoded row |

`Store.changes(scope)` (or a store/handle + optional selector) streams from `EventJournal.changes`.
Retention: `Store.register(…).pipe(Store.retention(500))`.

## Registration paths

| Form | Example |
|------|---------|
| Resource / Node | `Resource.store(Node)` / `Node.logs` |
| Process | `Process.store(Tag)` |
| Queue | `QueueResource.store(Tag)` |
| Custom queue | `CustomQueueResource.store(Tag)` |
| Run gate | `RunResource.store(Tag)` |
| String scope | `Store.register("scope", contract)` |

Resolve: `yield* AppStore.at(MyTag)` · `yield* AppStore.at("scope")` · `yield* MyTag.store`.

## Examples

- `examples/forms/store/store-memory.ts`
- `examples/forms/store/store-sqlite.ts`

## Related

- [Logs](/docs/logs) — durable log journals on the same Store
- [Queues](/docs/queues) — three-tier store example
- [Storage & Persistence](/docs/storage) — standards (three approved persistence shapes)
