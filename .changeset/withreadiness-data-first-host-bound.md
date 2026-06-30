---
"@nikscripts/effect-pm": patch
---

**Host-bound tags are now structurally assignable to `ResourceTag<any, any>` — the `withReadiness` band-aid is gone.** A `HostBoundTag` is a distinct `interface`, so it previously failed structural assignability to a bare `ResourceTag<any, any>` on the one invariant member, `[groupSym]` (a `ReadonlyMap` of `Rpc<methodName>`), forcing every helper to name `| HostBoundTag<any,any,any>`. That field is now erased to `RpcGroup.RpcGroup<any>` (the same shape `ServeEntry.tag` already used; the precise group is still built at runtime, only the field *type* is widened, and its sole reader just needs `.merge`). So a host-bound tag *is* a `ResourceTag<any, any>` — `Resource.withReadiness` accepts one on **both** the data-last (`.pipe`) and data-first overloads with no per-helper band-aid, and future helpers won't silently exclude host-bound tags.
