{#storage title="Storage & Persistence" order=80 appliesTo=src}
# Storage & Persistence

Persistence comes in exactly two approved shapes. Pick one; anything that fits neither is legacy and
gets redesigned onto one of them.

{#two-kinds-of-store .must appliesTo=src}
## Two kinds of store — append/read, or custom

All persistence is one of two shapes:

- **Append/read store** — a contract of named shapes, each exposing `.append` and `.read`, backed by
  an event journal (in-memory or SQLite). This is the event-log form: record history, replay it,
  stream changes. Reach for it whenever the data is a log of things that happened.
- **Custom store** — a bespoke store service with its own domain API and backend, for when append/read
  cannot express the semantics (leasing, at-least-once, priority). `DurableQueueStore` is the model:
  `offer` / `take` / `complete` / `fail` / `recover` / `drain` over its own SQLite table.

New persistence uses one of these two — nothing else.

{#default-or-serviceoption .must appliesTo=src}
## Default to in-memory only when it's meaningful; otherwise `serviceOption`

Whether a store is a defaulted service or an optional `serviceOption` is decided by one question:
**does an in-memory default carry value?**

- **Yes → bake in an in-memory default.** History and observability always want to record something;
  in memory unless the app provides a durable backing. A defaulted service (resolved unconditionally,
  never `serviceOption`) fits.
- **No → use `serviceOption`.** A durable queue's data already lives in memory — an in-memory
  "durable" store is pointless; the *only* value is surviving a restart. There is no default worth
  having, so durability is opt-in: provide a backend or get nothing.

`serviceOption` is not "the durability plane" — it's "no sensible default exists."

{#redesign-legacy-storage .must appliesTo=src}
## Legacy storage gets redesigned onto an approved shape

Storage that predates these two shapes — using neither the append/read store nor a custom store — is
**legacy**. Don't extend it or build new work on it. It is redesigned onto one of the two shapes for
**consistency** (one model across the package) and to **gain their benefits**: pluggable
memory/SQLite backends, schema-codec serialization, and event replay with change streams.
