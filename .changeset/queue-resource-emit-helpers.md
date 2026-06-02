---
"@nikscripts/effect-pm": minor
---

Replace flat `QueueResourceStore.record*` static emitters with scoped telemetry helpers (`emitEntryFact`, `emitLifecycleChange`, `emitDedupeKeyChange`, `emitRateLimitExceededFact`, and batch variants) backed by PascalCase `QueueResourceStore.Entry.*` / `.Lifecycle.*` / `.DedupeKey.*` / `.RateLimit.*` events.

Export `ProcessStore.optionalFacetEmit`, `optionalFacetEmitBatch`, `optionalFacetEmitWithBridge`, and `facetHasOwnMethod` for facet authors and tests. Fix optional telemetry field materialization so omitted inputs are not stored as `"undefined"` strings, with decode fallbacks for legacy rows.
