---
"@nikscripts/effect-pm": patch
---

Tighten Node transport `anyUnknownInErrorContext` surface (batch 1 — internal first).

- Listen siblings (`http` / `ws` / `unix` / `nPipe` / `connect` / `listenLocal`): catch-all `R=unknown` wiped; `ServeLayerList` uses discharged `E=never`; address-less claim uses soft `Lookup.Identity` (`IdentitySelfRequired` when missing) so Identity does not leak into Layer `R`.
- `mergeServeList` is generic; dynamic `RpcServer.layer` graphs assign through `any` at the boundary.
- Residual: `httpServer` / `wsServer` / `ipcServer` still use Effect-style `Layer<never, any, any>` variance for open serve `R` (same hole as `Layer.mergeAll`). Tracked in `docs/plans/any-unknown-in-error-context.md`.
