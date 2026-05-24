---
"@nikscripts/effect-pm": minor
---

Add **`ProcessStoreRuntime`** as a public storage facet backed by `RuntimeStorage` + spine (not `ProcessStore.append`). Runtime facts and state changes persist as `runtime.fact.recorded` / `runtime.state.changed` events with `facts`, `stateHistory`, `latestState`, and `runResourceFacts` query helpers.

**Breaking:** Remove `ProcessStore.runtime`, `ProcessStore.runResource`, and `RuntimeObserver.layerFromProcessStore`. Use `ProcessStoreRuntime` (`yield* ProcessStoreRuntime` then `.facts` / `.runResourceFacts`) and `RuntimeObserver.layer` (requires `ProcessStoreRuntime` in context). `ProcessStore.layerRuntimeStorage` and `layerProcessStore` now merge the runtime facet layer.
