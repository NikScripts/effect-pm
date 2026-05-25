# Runtime state, listener hooks, history, and mutable config

**Status:** Future work. Current storage rules live in [STORAGE.md](../STORAGE.md).

This plan tracks runtime state/history ideas that are still useful after the
storage refactor. It must not reintroduce the removed `ProcessStore` monolith,
`ProcessStoreInterface`, `RuntimeObserver`, or public generic runtime envelopes.

## Current assumptions

- `ProcessStore` is the facet builder (`Service`, `record`, `read`).
- `ProcessStorage` is the combined built-in layer host.
- `RuntimeStorage` is the adapter boundary for normalized rows.
- Each domain owns one public facet in `src/store/` and one documented
  `@nikscripts/effect-pm/store/*` subpath.
- Static facet emitters are optional and failure-isolated. Runtime behavior must
  not change when a storage layer is absent or a write fails.
- Reads live on the facet service instance, not on static facet methods and not
  on a monolith.

## Goals

1. Define stable state/history vocabulary for domains that need more than
   append-only facts.
2. Add listener or stream hooks without making storage adapters aware of domain
   APIs.
3. Support mutable runtime config only where the owning module can define clear
   lifecycle semantics.
4. Keep write paths concrete per domain. Shared generic envelopes may remain
   internal plumbing only.

## Candidate domains

| Domain | Storage shape | Open questions |
| --- | --- | --- |
| `ProcessSchedule` | schedule state transitions, arm/disarm history | How to model generated vs operator-driven transitions. |
| `Polling` | cadence changes and last tick hints | Whether this belongs in process execution records instead. |
| `HttpApiResource` | request facts, error summaries, rate-limit state | Cardinality and redaction policy for URLs/headers. |
| `QueueResource` | concrete queue wire events replacing the remaining internal envelope | Compatibility for existing SQLite rows. |

## Listener shape

Listeners should be layered beside facets, not under `RuntimeStorage`.

```typescript
class ProcessStoreMyDomain extends ProcessStore.Service<ProcessStoreMyDomain>()(
  "@nikscripts/effect-pm/store/MyDomain/ProcessStoreMyDomain",
  ProcessStore.record(/* static emitters */),
  ProcessStore.read(/* service reads */),
) {}
```

For in-process listeners, provide a custom service typed as
`ProcessStoreMyDomain.Type` and fan out from the record-section methods. If a
domain needs a first-class stream, add it as a separate public API after the
storage facet shape is stable.

## Non-goals

- No `yield* ProcessStore` service.
- No `ProcessStore.events(query)` replacement on a central facade.
- No public `RuntimeFact`, `RuntimeRef`, or `RuntimeStateChange` vocabulary for
  new domains.
- No file/NDJSON storage adapter.
- No adapter-specific domain methods.

## Graduation criteria

Move implemented behavior out of this plan and into regular docs when:

- the facet has concrete event types in `ProcessStoreEvent.ts`,
- the facet is listed in [STORAGE.md](../STORAGE.md),
- examples and conformance tests cover writes, reads, absent-layer behavior, and
  failure isolation,
- the package subpath is exported, and
- a changeset captures any public API or wire-format break.
