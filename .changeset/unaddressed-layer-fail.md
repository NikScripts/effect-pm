---
"@nikscripts/effect-pm": patch
---

**Unaddressed Node failures use Effect/Layer error channels** — no sync `throw`.

- `Resource.UnaddressedNode` is public; `connect` / `connectIpc` / `ipcClient` / `listen` / `verifyConnection` fail with it via `Effect.fail` / `Layer.effectDiscard`.
- `Lookup.layerNode` / `Lookup.client` fail with `LookupUnaddressed` the same way.
- Catch via `Exit` / `CatchTag`, not `try/catch` around the factory call.
