---
"@nikscripts/effect-pm": minor
---

Reorganize `src/` into Effect-style flat public modules plus `internal/store` and `internal/manager` helpers. **Breaking:** remove `./ProcessStoreGroupLog` and `./QueueResourceStore` package subpaths; facet services are exported under `store/*` subpaths and composed via `ProcessStore.layer` / `store.Log` / `store.QueueResource`. Public PM modules are now `LogContext`, `LogEntry`, and `Transport`; root `index.ts` no longer re-exports internal log query/watch helpers or `groupChild`. Add `relayWithCaptureLoggerLayer` on `@nikscripts/effect-pm/Logs` for child-runtime wiring.
