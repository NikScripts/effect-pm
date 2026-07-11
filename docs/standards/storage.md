{#storage title="Storage & persistence" order=80 appliesTo=src}
# Storage & persistence

This chapter is the single source of truth for persistence. Read it before changing `Store`, a
`*.store(tag)` registration, a `src/store/*` facet, or any engine's store wiring. The model is small:
two planes, one defaulted service, three tiers, schema-codec serialization.

{#two-planes .must appliesTo=src}
## Two planes, never conflated

Persistence has two planes with different jobs — keep them apart:

- **The Store bridge** (`Store.Service`, `Storage`, `Tag.store(tag)`, backed by `EventJournal`) holds
  **execution history** — the lifecycle of Processes, Queues, and Run gates.
- **RuntimeStorage facets** (`LogStore`, `ProcessLifecycleStore`) hold **legacy observability** — log
  relay and lifecycle rows, nothing else.

Execution history lives on the Store bridge **only**. Engines never write to a facet emitter.

{#storage-is-defaulted .must appliesTo=src}
## `Storage` is a defaulted service — engines never `serviceOption` it

`Storage` is a defaulted service, like `Clock`: it is always present. An engine does `yield* Storage`,
resolves its handle once, and writes unconditionally. Never `Effect.serviceOption(Storage)`, never
sniff for it on a forked fiber, never resolve it lazily per-event — the lazy path races the scoped
`EventJournal` build and deadlocks.

``` ts
// ✅ good — resolved once, up front, written unconditionally
const store = yield* materializeEngineQueueStoreForTag(tag)
yield* store.record(event)

// ❌ bad — optional/lazy resolution of an always-present service
const store = yield* Effect.serviceOption(Storage)   // races the journal build → deadlock
```

{#serviceoption-only-durability .must appliesTo=src}
## `serviceOption` is only for the durability plane

The one place `serviceOption` is correct is the **durability** plane — `DurableQueueStore`,
`HistoryStore` — where the presence of the layer is deliberately the switch. Those calls are right;
leave them. The rule above bans it for `Storage`, not for these optional ports.

{#provide-merge-store .must appliesTo=src}
## Merge the store with `provideMerge`; apps override at the root

A toolkit `layer` / `serve` / `serveRemote` merges the default in-memory store with
`Layer.provideMerge` (never `Layer.provide`), so an app can supply a real store at the root and win
the merge. Never hard-provide a store inside a toolkit layer in a way that blocks the override.

``` ts
// app root — the durable store wins over the toolkit's default
Layer.provideMerge(AppStore.layer({ filename: ".effect-pm/data.sqlite" }), resourceLayers)
```

{#three-tiers .must appliesTo=src}
## Build persistence in three tiers

Persistence for a resource is three layers, built once, never rebuilt:

- **Tier 1 — lean base.** One `event` shape → `record` + `events`, from `builtIn*StoreContract(tag)`.
- **Tier 2 — engine writes.** Narrow semantic methods (`completed`, `failed`, …) that funnel to the
  base's `event.append`.
- **Tier 3 — analytics.** Read derivations over `event.read`, registered with `*.store(tag)`.

Stack tiers with `Store.extend`; never rebuild the base with `Store.contract` to add a tier.

{#persisted-equals-streamed .must appliesTo=src}
## Persisted equals streamed

A store persists the **exact** shape its `.events` stream emits — one tagged-union `event` per scope,
the same rows on disk and on the wire. Don't invent a separate persisted shape; persisted == streamed
is what lets history and the live stream be one source of truth.

{#schema-codec-serialization .must appliesTo=src}
## Serialize through schema codecs, never by hand

Every row round-trips through Effect's schema codecs (`Store.effects` / `Schema.toCodecJson`) — never
a hand-rolled `toJSON`. Rich types (`DateTimeUtc`, `Exit`, `Cause`, `Duration`) persist as identity
codecs a naive JSON walk cannot reproduce; only the schema encodes them. An encode mismatch is a
**defect** (`Effect.orDie`) — it means the schema is wrong, not that the write failed.

{#writes-never-fail-work .must appliesTo=src}
## Storage failures never fail the work they observe

Observability writes must never take down the work they record. Engine writes are wrapped in
`Store.catchWriteErrors` (log and swallow), and the write channel is honestly typed: an IO write
failure is a catchable `StoreWriteError`; a read decode failure is `StoreJournalDecodeError`. The
error type carries its category — see *No casts → type writes honestly* (never `Effect<…, never>`).

{#durability-presence-driven .must appliesTo=src}
## Durability is presence-driven

There is no `persist: true` flag. Durability is chosen by which layer you provide: `layerMemory` is
ephemeral, `layer({ filename })` is durable. A durable store is a `SqlEventJournal` on a shared
`SqlClient` — **one `Store.Service` = one database file = one `EventJournal`** — never a bespoke rows
table.

{#retire-legacy-facets .must appliesTo=src}
## Retire the legacy facets — don't reintroduce them

The old execution-history facet classes (`ProcessExecutionStore`, `QueueResourceStore`,
`RunResourceStore`) are deleted. Do not document, resurrect, or dual-write to them — engines use the
Store bridge (`Process.store` / `QueueResource.store` / `RunResource.store`). Only `LogStore` and
`ProcessLifecycleStore` remain, as optional observability read through `serviceOption`.
