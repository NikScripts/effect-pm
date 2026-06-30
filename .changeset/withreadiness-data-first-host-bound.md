---
"@nikscripts/effect-pm": patch
---

**`Resource.withReadiness` accepts host-bound tags on both forms.** A `HostBoundTag` is a distinct interface, so it isn't structurally assignable to a bare `ResourceTag<any, any>` (its one invariant member, the `[groupSym]` RPC-group map). The data-last `.pipe` overload names both arms (`ResourceTag<any, any> | HostBoundTag<any, any, any>` — the honest "any tag, host-bound or not" input, the same shape `Resource.client` uses); the data-first overloads are **inferred** (host-bound first, then hostless), so `Resource.withReadiness(SomeHostBoundClass, fn)` accepts a fully-defined class — a `typeof X` constructor — the way `client`/`layer` do, and preserves the host in the return. Group types stay fully precise (`RpcGroupOf<S>`) — no type erasure, no cast.
