# Store backing — EventJournal + SQL

Append-only store data goes through Effect's `effect/unstable/eventlog` (`EventJournal`). SQL
persistence is `SqlEventJournal` on a shared `SqlClient` — **not** a custom row table.

Mutable by-key state (resource refs, memoized exits, caches) uses `effect/unstable/persistence`
(`Persistence`, `KeyValueStore`) — **not** `Store`.

> **API + mental model:** [`store.md`](./store.md).

---

## Two primitives

| Concern | Effect module | Store usage |
|---------|---------------|-------------|
| **Append-only** rows (shapes, events, history, facets) | `effect/unstable/eventlog` | `Store.Service.layer` / `layerMemory` |
| **By-key mutable** state | `effect/unstable/persistence` | Resource refs, idempotency — **outside** `Store` |

*Persistence for persistence, eventlog for append-only data — one for each.*

---

## The `Storage` service

Every store handle resolves through a single service, `Store.Storage`, which carries the internal
scope bridge (`.at(scope, contract)` → handle, `.changes(scope)` → stream). You almost never touch it
directly — `resolve` / `resolveOrDie` / `MyStore.at` / `tag.store` and every `Store.effects` method
resolve through it for you.

Two ways `Storage` gets into context:

- **An app `Store.Service` layer** — `AppStore.layerMemory` / `AppStore.layer({ filename })` provide
  both the store bundle **and** `Storage` (backed by that layer's journal).
- **The baked-in in-memory default** — a resource layer bakes a process-local in-memory `Storage` so
  its engine can record observability with **no app store provided**. An app store overrides it by
  plain layer composition (same tag, later layer wins). This is what makes `resolveOrDie` total on the
  always-on path: the default materializes any scope on demand.

---

## How `Store` maps onto `EventJournal`

Each `store.<shape>.append` writes one journal entry:

| Journal field | Store meaning |
|---------------|---------------|
| `primaryKey` | Registration `scopeKey` (tag `.key` or string scope) |
| `event` | Shape / append method name (`readings`, `event`, …) |
| `payload` | Encoded row (schema-decoded before write) |

Each `store.<shape>.read`:

1. `yield* EventJournal.entries`
2. Filter `primaryKey === scopeKey` and `event` in the query's source shapes
3. Decode payloads
4. Apply read payload (`limit`, `since`, `until`) via shared query helpers
5. Schema-decode the result

`Store.changes(scope)` subscribes to `EventJournal.changes`, filters by `primaryKey`, maps to
`StoreChangeEvent`. `Store.retention(n)` trims oldest rows per scope in SQL (`effect_event_journal`);
the in-memory journal applies the cap on read (no delete API).

---

## Layers

```ts
import * as Store from "@nikscripts/effect-pm/Store";

// Memory — EventJournal.layerMemory (process-local, lost on exit)
Effect.provide(program, AppStore.layerMemory);

// Durable — SqliteClient + SqlEventJournal (same file survives reconnect)
Effect.provide(program, AppStore.layer({ filename: ".effect-pm/data.sqlite" }));

// Ephemeral SQL (isolated in-process file)
Effect.provide(program, AppStore.layer({ filename: ":memory:" }));
```

Stack inside `layer({ filename })`:

```
SqliteClient.layer({ filename })
  → SqlEventJournal.layer()     // effect_event_journal table
  → Store bundle + scope bridge (Storage)
```

One `Store.Service` class = one database file = one shared `EventJournal`. Entries survive
reconnecting with a new scoped layer on the same path.

---

## Durability

Store durability is **presence-driven**: `layerMemory` is ephemeral; `layer({ filename })` on a real
path is durable. There is no `persist: true` flag on a store — the layer you provide is the switch.
(The queue's *durable work store* is a separate, also presence-driven mechanism — see
[`history-and-persistence.md`](./history-and-persistence.md).)

The always-on **observability** store (a resource's lifecycle event log) is baked in as the in-memory
default, so it exists with zero configuration; provide an app `Store.Service` layer over the same tag
to make it durable.

---

## `StoreWriteError` — write-failure semantics

The storage layer distinguishes two failure kinds on the append path, and that distinction is the
whole reason writes are recoverable without touching reads:

| Failure | Channel | Rationale |
|---------|---------|-----------|
| **Journal / IO write** fails | `StoreWriteError` (a catchable `Data.TaggedError`, `@public`) in the effect's `E` | A transient IO/journal hiccup — recoverable; the append path maps it here. |
| **Encode / serialization** mismatch | **Defect** (`Effect.orDie`) | The value doesn't fit the declared shape — a bug, not a runtime condition. |
| **Read** decode fails | `StoreJournalDecodeError` | Reads keep their own error; unaffected by write handling. |

Because the error **carries** its category, no method needs a "this is a write" marker.
`Store.catchWriteErrors` (see [`store.md`](./store.md)) narrows `StoreWriteError` out of the write
methods — logs + swallows — while defects (encode/wiring) and read errors propagate untouched.

`StoreWriteError` fields: `{ cause: unknown; detail?: string }`.

---

## What we explicitly do **not** do

- **No** bespoke store-rows table — `EventJournal` is the substrate.
- **No** in-memory `Ref` as a source of truth beside the journal.
- **No** `EventLog` typed handlers / remote sync unless you opt in later — `Store` uses `EventJournal`
  directly (append + filter reads), not the full sync server stack.

---

## Related

- API + mental model: [`store.md`](./store.md)
- Migration: [`store-migration.md`](./store-migration.md)
- Golden example: [`queue-resource.md`](./queue-resource.md)
- Design handoff: [`../../handoffs/store-and-logs-design.md`](../../handoffs/store-and-logs-design.md)
</content>
