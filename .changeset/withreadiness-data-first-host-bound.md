---
"@nikscripts/effect-pm": patch
---

**`Resource.withReadiness` accepts host-bound tags on both overloads.** A `HostBoundTag` is a distinct interface, so it isn't structurally assignable to a bare `ResourceTag<any, any>` (its one invariant member, the `[groupSym]` RPC-group map). Both overloads now take `ResourceTag<any, any> | HostBoundTag<any, any, any>` — the honest "any tag, host-bound or not" input (the same shape `Resource.client` uses). So a host-bound queue/process can extend its readiness to depend on another resource via the data-last `tag.pipe(Resource.withReadiness(...))` form. Group types stay fully precise (`RpcGroupOf<S>`) — no type erasure, no cast.
