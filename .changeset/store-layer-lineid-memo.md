---
"@nikscripts/effect-pm": patch
---

Durable store-layer `(scopeKey, lineId)` memo for log tails.

Durable tails seed their in-memory lineId claim from existing `_logs` rows at layer acquire, so rematerialize / restart against SQLite (or any durable journal) does not re-append the same relay line. Live-session claim behavior unchanged. Unrelated to store-handle `memoizedAt`.
