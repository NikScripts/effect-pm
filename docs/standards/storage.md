{#storage title="Storage & Persistence" order=80 appliesTo=src}
# Storage & Persistence

Persistence comes in exactly three approved shapes. Pick one; anything that fits none is legacy and
gets redesigned onto one of them.

{#three-kinds-of-store .must appliesTo=src}
## Three kinds of persistence — append/read, custom store, or engine-owned keyed SQL

All persistence is one of these shapes:

- **Append/read store** — a contract of named shapes, each exposing `.append` and `.read`, backed by
  an event journal (in-memory or SQLite). This is the event-log form: record history, replay it,
  stream changes. Reach for it whenever the data is a log of things that happened.
- **Custom store** — a bespoke store service with its own domain API and backend, for when append/read
  cannot express the semantics (leasing, at-least-once, priority). `DurableQueueStore` is the model:
  `offer` / `take` / `complete` / `fail` / `recover` / `drain` over its own SQLite table.
  Use a `Context.Service` port when durability is presence-driven (`serviceOption`) or a second
  backend is likely.
- **Engine-owned keyed SQL** — when the product is **current keyed state** (a Map of live rows), the
  engine owns a SQLite table directly (`SELECT` / `UPSERT` / `DELETE`). No Store bridge, no separate
  store port, no event replay. Default the client to `:memory:` when an in-process default carries
  value; pass a filename for crash-surviving durability. **Model: `ShardMap`**
  (`effect_pm_shard_map` in `src/internal/shardMapSql.ts`).

New persistence uses one of these three — nothing else. Do not event-source a Map "because Process
does history."

{#default-or-serviceoption .must appliesTo=src}
## Default to in-memory only when it's meaningful; otherwise `serviceOption`

Whether a store / engine SQL client is defaulted or optional is decided by one question:
**does an in-memory default carry value?**

- **Yes → bake in an in-memory default.** History and observability always want to record something;
  in memory unless the app provides a durable backing. A defaulted service (resolved unconditionally,
  never `serviceOption`) fits. Engine-owned SQL uses `:memory:` the same way (`ShardMap.layer`).
- **No → use `serviceOption`.** A durable queue's data already lives in memory — an in-memory
  "durable" store is pointless; the *only* value is surviving a restart. There is no default worth
  having, so durability is opt-in: provide a backend or get nothing.

`serviceOption` is not "the durability plane" — it's "no sensible default exists."

{#redesign-legacy-storage .must appliesTo=src}
## Legacy storage gets redesigned onto an approved shape

Storage that predates these shapes — using none of append/read, custom store, or engine-owned keyed
SQL — is **legacy**. Don't extend it or build new work on it. It is redesigned onto one of the
approved shapes for **consistency** (one model across the package) and to **gain their benefits**:
pluggable memory/SQLite backends, schema-codec serialization, and (for journals) event replay with
change streams.
