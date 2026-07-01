# Problem: per-resource source layers force `Effect.provide` inside tick bodies

> **Design response (beta.18):** [`per-resource-dependency-serve-design.md`](./per-resource-dependency-serve-design.md)
> — settled in package terms (dependency `R`, not "source"): per-resource `Layer.provide` on a
> `Resource.serve(tag, impl)` layer + `Resource.httpServer` reading a served-resources registry. No
> config-embedded layer, no branding.

> A consumer (wow-sports services-hub) report. This is a **problem statement**, not a proposed API —
> the goal is to find the idiomatic effect-pm shape. Grounded in `Resource.serveAllHttp` /
> `ScheduledProcess` / `QueueResource` as of 0.8.0-beta.16.

## The problem

Every hub tick satisfies its own requirement `R` by calling `Effect.provide(sourceLayer)` **inside the
tick body**:

```ts
export const nwslGetSeasonMatchesTick = Effect.gen(function* () {
  const client = yield* NwslsoccerClient;
  yield* client.season.getSeasonMatches({ … });
}).pipe(
  Effect.provide(NwslHub.processTickHandlersLayer),   // ← mid-pipeline provide
  Effect.catch(…), Effect.asVoid,
);
```

`@effect/language-service`'s `strictEffectProvide` flags this (`Effect.provide` with a layer outside an
application entry point). Across services-hub there are 9 such sites. We can't just hoist them to a
single serve-level provide — see the constraint below.

## Why the self-provide exists (the real constraint)

On one `serveAllHttp` host, resources are **heterogeneous in the source/handler layer they need**, and
those layers are **mutually exclusive** — they provide the _same_ ambient service tag with _different_
implementations:

| Resource                                              | needs                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| bare-client ticks (GetSeasonMatches, LiveScorePoller) | a **stateless handler registry** (`SchemaImportHandlers.layer`)   |
| phased-import processes (IncrementalSeasonImport)     | a **hooked** source layer (`afterEachPersistedRow` enqueue hooks) |
| queue workers (roster/media)                          | an **empty-hook** source layer                                    |

`serveAllHttp` unions every entry's `R` into **one** requirement, satisfied by **one** shared provide at
the serve root (`Resource.ts` ~1505 `ServeEntriesR<Entries>`; ~1525 `buildImpl` + the union). One shared
provide can't hand entry A a different impl than entry B — so each tick self-provides _its_ layer. The
per-tick `Effect.provide` is currently the **only** per-resource seam.

**Why the naive fix is worse:** providing one source layer to all entries at the serve hands the hooked
phased source to the queue workers → double-enqueue (a bug we have actually hit). So the heterogeneity
is load-bearing, not sloppiness.

## Effect-version context (why this is idiom, not a live bug)

- **v3 had the affordance:** `Effect.Service({ effect, dependencies: [Layer…] })` — declare deps, the
  framework provides them at layer build. **v4 removed it** in favor of pure layer composition
  (`Layer.provide`). So there's no per-unit "dependencies" hook in v4 anymore.
- **v4 shares provides by default:** `Effect.provide(effect, layer, { local })` — "_by default, layers
  are shared between provide calls_; use `local` to rebuild every time." So a mid-pipeline provide does
  **not** re-acquire per tick execution by default. The scope-lifetime hazard `strictEffectProvide`
  warns about is largely de-fanged in v4, and our flagged layers are stateless anyway. So here the rule
  is about **idiom/DRY**, not a correctness bug.
- **The rule targets `Effect.provide` only** (it matches a reference to the Effect module's `provide`,
  not `Layer.provide`). So any fix expressed as **layer composition** satisfies it by construction.

## What effect-pm already has (the plumbing is close)

- `serveAllHttp` builds each entry impl and unions `R` (`Resource.ts` ~1525); `serverLayer(tag, impl)`
  (line ~1393, `Layer.provide(serverLayer(tag, impl))`) is a natural per-entry layer seam.
- `ScheduledProcess` already wraps each handle's effect at the runtime boundary with its own
  `provideR = (eff) => Effect.provide(eff, context)`.
- `Resource`'s **Effect form** of `serverEntry`/`layer` already lets a custom resource provide its `R`
  alongside (e.g. `peersLayer`).

So provide-at-the-framework-boundary exists; the gap is a **per-entry** seam for `ScheduledProcess` /
`QueueResource` so each resource can carry _its own_ source layer.

## One possible direction (illustrative, not decided)

A per-entry `provide?: Layer` on the serve config, composed per-entry via `Layer.provide` at the serve
root — before the `R` union — so the tick declares `R` and effect-pm satisfies it per-resource:

```ts
ScheduledProcess.serverEntry(NwslGetSeasonMatches, { …, provide: NwslHub.processTickHandlersLayer })
QueueResource.serverEntry(NwslRosterImportQueue,   { …, provide: NwslHub.sourceDefaultLayer })
```

Open questions for the real design: does the source belong on the **Tag** definition or the **serve
config**? Is it `provide` / `dependencies` / `layer`? Should it compose via `Layer.provide` at
`serverLayer`, or provide the build-`R` at the framework root? Should the local-boot `.layer` form share
the same field?

## The ask

**What's the idiomatic effect-pm shape for "each resource carries its own source layer, provided
per-resource at the serve," so tick bodies declare `R` instead of self-providing `Effect.provide`?**
It would let consumers set `strictEffectProvide: error` cleanly, and keeps the heterogeneous
per-resource sources isolated (no shared-provide double-enqueue).
