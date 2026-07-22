---
"hyperlink-ts": minor
---

**Dependency-aware readiness.** A resource's readiness can now compose other resources' readiness, so a queue/process that depends on a database (or any resource) reports degraded when its dependency is.

- **`withReadiness` derivations receive the prior readiness as a second argument, `base`** — the check already on the tag (e.g. a contract factory's `phase === "running"`). Extend it (`yield* base` then AND your checks) instead of silently replacing it; `withReadiness` now *stacks* (each call wraps the prior). Single-arg derivations keep working.
- **`Resource.readinessOf(tag)`** — pull a resource's readiness by tag (yields its service + runs its derivation). Use it inside another resource's `withReadiness` to depend on it: `yield* Resource.readinessOf(Database)`. The dependency lands in the readiness Effect's requirements, so it's **compile-time checked**, and it works local *or* remote (it re-derives from the dependency's served status).
- **`Resource.allReady(checks)`** — combine readiness checks with AND (first not-ready wins, with its detail).

```ts
class Jobs extends QueueResource.Tag<Jobs>()("app/Jobs", Item).pipe(
  Resource.withReadiness((_svc, base) =>
    Resource.allReady([base, Resource.readinessOf(Database)])),
) {}
```

Note on the *acquisition* side (complements this, not part of the API): get hard dependencies ready by acquiring them eagerly with `Layer.scoped` so failures surface at boot and the resource is warm by first use (lean on the driver's lazy physical connections to avoid idle sockets); go lazy only for conditional dependencies, single-flighting init with `Effect.cached` into the service's own scope. `Layer` handles "starts first"; readiness handles "stays ready".
