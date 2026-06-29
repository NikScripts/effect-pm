---
"@nikscripts/effect-pm": patch
---

**Host-bound tags can extend readiness via `.pipe`.** `tag.pipe(Resource.withReadiness(...))` on a host-bound tag (a `HostBoundTag` — i.e. a tag built with `{ host }`) previously failed to typecheck: `HostBoundTag` is a distinct interface, so `.pipe`'s `this` assignment to a bare `ResourceTag<any, any>` tripped its invariant `[groupSym]` map (`Rpc<"method">` vs `Rpc<string>`). The data-last `withReadiness` overload now names `HostBoundTag` in its constraint, keeping the comparison same-generic (lenient). So a host-bound queue/process can extend its readiness to depend on another resource (`readinessOf(Database)`) — verified end-to-end in `examples/resource-web` (the box-score queue cascades to degraded when its `ScoresDb` dependency blips).
