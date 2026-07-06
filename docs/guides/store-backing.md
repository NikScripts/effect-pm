# Store backing — EventJournal + SQL

**This is the storage architecture you asked for.** Append-only store data goes through
`effect/unstable/eventlog` (`EventJournal`). SQL persistence is `SqlEventJournal` on a shared
`SqlClient` — not a custom row table.

Mutable by-key state (resource refs, memoized exits, caches) uses `effect/unstable/persistence`
(`Persistence`, `KeyValueStore`) — **not** `Store`.

---

## Two primitives

| Concern | Effect module | Store usage |
|---------|---------------|-------------|
| **Append-only** rows (shapes, logs, history, facets) | `effect/unstable/eventlog` | `Store.Service.layer` / `layerMemory` |
| **By-key mutable** state | `effect/unstable/persistence` | Resource refs, idempotency — **outside** `Store` |

Your instruction (2026-07-04): *"Persistence for persistence, eventlog for append-only data — one for each."*

---

## How `Store` maps onto `EventJournal`

Each `store.<shape>.append` writes one journal entry:

| Journal field | Store meaning |
|---------------|---------------|
| `primaryKey` | Registration `scopeKey` (tag `.key` or string scope) |
| `event` | Shape / append method name (`readings`, `entry`, …) |
| `payload` | MessagePack-encoded row (schema-decoded before write) |

Each `store.<shape>.read`:

1. `yield* EventJournal.entries`
2. Filter `primaryKey === scopeKey` and `event` in query source shapes
3. Decode MessagePack payloads
4. Apply read payload (`limit`, `since`, `until`) via shared query helpers
5. Schema-decode result

`Store.changes(scope)` subscribes to `EventJournal.changes`, filters by `primaryKey`, maps to
`StoreChangeEvent`.

`Store.retention(n)` trims oldest rows per scope in SQL (`effect_event_journal`); in-memory journal
applies the cap on read (no delete API on memory journal).

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
  → Store aggregate + bridge
```

One `Store.Service` class = one database file = one shared `EventJournal`.

---

## What we explicitly do **not** do

- **No** bespoke `effect_pm_store_rows` table (removed)
- **No** in-memory `Ref` as the source of truth beside the journal
- **No** `RuntimeRecord` + `Query` DSL for `Store` (legacy facet substrate — separate migration)
- **No** `EventLog` typed handlers / remote sync unless you opt in later — `Store` uses
  `EventJournal` directly (append + filter reads), not the full sync server stack

---

## Related

- API guide: [`store.md`](./store.md)
- Design handoff: [`../handoffs/store-and-logs-design.md`](../handoffs/store-and-logs-design.md)
- Legacy facet SSOT: [`../STORAGE.md`](../STORAGE.md) (RuntimeStorage — not Store)
