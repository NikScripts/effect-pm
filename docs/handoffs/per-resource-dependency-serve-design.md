# Design: per-resource dependency provision at the serve (beta.18)

**Status:** the full surface is **built + tested** on branch `cursor/beta-18-dependency-serve` —
`Resource.serve` (preserves `R`, isolation), `Resource.httpServer` + `ServedResources` /
`servedResourcesLayer` (shared server + `/health` from the registry). typecheck / effect-ls / eslint
clean, 375 tests. The **ordering held** (registry populated before the server reads it) — validated by
`/health` listing both resources in `test/multi-resource-http-server.test.ts`. Remaining, optional:
re-basing `serveAllHttp` as sugar over `serve`/`httpServer` (§5.3) — the existing `serveAllHttp` is
untouched and still the right tool for the shared-dependency case. Target release beta.18.
**Problem report:** [`2026-07-01-per-resource-source-provide.md`](./2026-07-01-per-resource-source-provide.md)
(the consumer statement; note "source" there is a wow `EventManager` term — **it is not used in this
design or in any effect-pm surface**; the general concept is a resource's requirement `R`).

---

## 1. The problem, in package terms

On one `serveAllHttp` host, different resources require **different implementations of the same ambient
service tag** — and those implementations are **mutually exclusive** (e.g. one fires post-persist enqueue
hooks, another must not). `serveAllHttp` unions every entry's requirement `R` into **one** shared provide
at the serve root, so it structurally cannot hand resource A one implementation and resource B another.

Consumers work around it by providing the dependency **inside each tick/worker body**
(`Effect.provide(depLayer)`), which `@effect/language-service`'s `strictEffectProvide` flags. Hoisting to
the single shared provide is not an option: it hands one implementation to every resource, which has
caused a real double-enqueue.

**Goal:** each served resource carries its own requirement, satisfied **per resource** by ordinary
`Layer.provide`, so tick/worker bodies just declare `R` (no `Effect.provide`), and consumers can run
`strictEffectProvide: error`.

## 2. Rejected shapes (do not re-propose — each has a concrete reason)

- **A `provide` / `dependencies` field on the serve config** (`serverEntry(tag, impl, { provide: layer })`).
  Rejected on two counts: (a) Effect never takes a `Layer` as config **data** — layers compose only via
  `Layer.provide`; (b) it re-creates the exact **memoization/sharing ambiguity** that got
  `Effect.Service({ dependencies })` removed in v4. From data you cannot express "share this instance
  across these resources" vs. "give each its own" — which **is** the double-enqueue bug.
- **Tag-branded layers** (a `Layer` phantom-branded with its tag so the serve can recover the tag).
  Rejected: brittle, and we do not use type-level branding.
- **wow's "source" vocabulary** anywhere in the surface. The dependency is generic `R`; a resource could
  equally need a DB pool or an HTTP client. Our names describe **serving**, never the dependency.

## 3. Design — compose at the layer level; the only new names are about serving

Dependencies are provided with **Effect's own `Layer.provide` / `Layer.mergeAll`**, per resource. The
package adds two serving primitives (and, at most, one thin sugar):

| Primitive | Type (sketch) | Role |
|-----------|---------------|------|
| `Resource.serve(tag, impl)` | `Layer<ServedResources, never, HandlerContextOf<S>>` | One resource's handler layer: mounts its group's handlers on the shared server **and** self-registers the tag (groupId, kind, readiness) into the `ServedResources` registry. Its requirement is `HandlerContextOf<S>` — the resource's `R` — discharged by a `Layer.provide` on it. |
| `Resource.httpServer(options?)` | `Layer<never, never, ServedResources \| HttpServer.HttpServer>` | The shared http `RpcServer` over the registered groups + the `/health` route + host-status, all read from the registry. |
| *(optional)* `Resource.provide(layer, resources)` | `= Layer.mergeAll(resources).pipe(Layer.provide(layer))` | Sugar for "these resources share this dependency." Named `provide` (Effect's word). **Ship only if the raw form proves noisy.** |

A per-resource dependency is `Layer.provide`d onto that resource's `serve` layer (or a merged group of
them). This **discharges the requirement locally**, so it never enters a shared union → no cross-resource
collision, by construction.

## 4. Consumer surface

```ts
const Host = Resource.httpServer({ health: { path: "/health" } }).pipe(
  Layer.provide(
    Layer.mergeAll(
      // resources sharing a dependency → one Layer.provide over a merge
      Layer.mergeAll(
        Resource.serve(SeasonMatches,   seasonMatchesImpl),
        Resource.serve(LiveScorePoller, pollerImpl),
      ).pipe(Layer.provide(importHandlersLayer)),

      // a resource with its own, different implementation of the same tag — isolated
      Resource.serve(SeasonImport, seasonImportImpl).pipe(Layer.provide(hookedImportLayer)),

      Layer.mergeAll(
        Resource.serve(RosterImportQueue, rosterImpl),
        Resource.serve(MediaQueue,        mediaImpl),
      ).pipe(Layer.provide(plainImportLayer)),
    ),
  ),
  Layer.provide(NodeHttpServer.layer(/* … */)),
);
```

The tick/worker body declares its requirement and never provides it:

```ts
export const seasonMatchesImpl = {
  tick: Effect.gen(function* () {
    const handlers = yield* ImportHandlers;  // declared — provided by Layer.provide above
    const client   = yield* NwslsoccerClient;
    yield* handlers.run(client.season.getSeasonMatches({ /* … */ }));
  }),
};
```

The dependency layers (`importHandlersLayer`, `hookedImportLayer`, …) are **named by the consumer**, in
their vocabulary. The package contributes only `serve` / `httpServer`.

## 5. Mechanism (the parts to prototype)

1. **`ServedResources` registry.** A Context service holding the served resources' metadata
   (`{ groupId, kind, readiness }`), appended by each `Resource.serve` at build. `httpServer` reads it to
   build the same readiness aggregate `serveAllHttp` builds today (SSOT for `/health` + host-status) —
   just populated by registration instead of an entries array. Simplest impl: a `Ref` keyed by
   `groupId`; **reject duplicate `groupId`s** with a clear error at build.
2. **One shared `RpcServer` over the registered groups.** Groups are prefix-namespaced by `groupId`, so
   many resources share one `/rpc` with no collision. **✅ PROVEN** (`test/_proto-serverR.test.ts` on
   branch `cursor/beta-18-dependency-serve`): two `group.toLayer(handlers)` layers, each with a
   *different* value of the **same** `Dep` tag `Layer.provide`d (A←1, B←2), feed one `RpcServer` over
   `groupA.merge(groupB)`; over http a client reads `A.read → 1` and `B.read → 2` — **isolated, not
   collapsed**. So we can stop merging impls into one table without losing the single server; the design's
   load-bearing assumption holds.

   **Key finding, now resolved:** today's `serverLayer` **erases** the handlers' `R`
   (`as Layer<HandlerContextOf<S>>`, `Resource.ts` ~1375). That erasure is *why* all handlers currently
   share one ambient provide — so per-resource isolation needs it removed (else `Layer.provide(dep)` looks
   unused and gets pruned). **`Resource.serve` is built and real** (not a cast-fake):
   `serve(tag, impl): Layer<HandlerContextOf<S>, never, ServeRequirements<Impl>>` — it **infers and
   preserves** the handlers' requirement. The precise-`R` typing (the earlier open question) is solved by
   extracting `R` from the impl **value** via `ServeRequirements<Impl>` (a `[keyof Impl]` union over the
   four `ServeMethod` forms) rather than a mapped-type parameter (which TS won't infer through). No loose
   casts — only the same documented dynamic-handler boundary `serverLayer` already uses. effect-ls clean;
   isolation proven in `test/multi-resource-isolated-deps.test.ts` (A←Dep=1, B←Dep=2, one `/rpc`, read
   back 1 and 2). `serverLayer` (R-erasing) stays for the build-time-resolved case; `serve` is the
   run-time-requirement primitive and subsumes it (`R = never` behaves identically).
3. **`serveAllHttp` becomes sugar** for the common single-dependency case:
   `serveAllHttp([{ tag, impl }])` ≡ `httpServer().pipe(Layer.provide(mergeAll(entries.map(e => serve(e.tag, e.impl)))))`,
   with any shared dependency provided once at the root. Keep it — most hosts are homogeneous.

## 6. Sharing semantics — the acceptance test

This is the bar the design exists to satisfy; make it an explicit test:

- Two resources given the **same dependency `Layer` value** → **one** memoized instance (shared).
- Two resources given **distinct implementations** of the same tag (different `Layer` values), or the
  same layer wrapped in `Layer.fresh` → **separate** instances (isolated).
- **The double-enqueue regression:** a hook-firing dependency provided to one resource must **not** reach
  a sibling that was given the plain one. Assert it directly.

## 7. `strictEffectProvide`

No `Effect.provide` appears in consumer code — bodies `yield*` their requirement tag; the dependency is
`Layer.provide`d at composition. A consumer can set `strictEffectProvide: "error"` and stay clean.

## 8. Migration

- **Shared dependency (the common case):** unchanged — `serveAllHttp([{ tag, impl }]).pipe(Layer.provide(dep))`.
- **Heterogeneous dependencies:** `Resource.httpServer(...)` + per-resource `Resource.serve(...)` +
  per-group `Layer.provide(dep)`.
- **Delete** `Effect.provide(dep)` from tick/worker bodies; declare the requirement in the body instead.

## 9. Open questions for the build

- `httpServer` options should mirror `serveAllHttp`'s (`path`, `serialization`, `health`).
- Does the local-boot path need a parallel? Likely not — `Resource.serve` is just a layer, usable
  wherever, so a local runtime merges the same `serve` layers without an http server.
- Registry as a `Ref` vs. an accumulated context value — settle during the prototype (Ref keyed by
  `groupId` is the leading candidate; verify it composes cleanly under `Layer.mergeAll`).
- Whether to ship the `Resource.provide(layer, resources)` sugar in beta.18 or wait for demand.

## 10. Definition of done

- ✅ **Built:** `Resource.serve` (R-preserving), `Resource.httpServer`, `ServedResources` /
  `servedResourcesLayer`. typecheck / effect-ls / eslint clean, 375 tests, build clean.
- ✅ Serves multiple resources on one `/rpc` with `/health` listing all of them —
  `test/multi-resource-http-server.test.ts` (also proves the registry ordering).
- ✅ Isolation: two resources, same tag, different values, read back distinct —
  `test/multi-resource-isolated-deps.test.ts`. (The `Layer.fresh` case is inherent to Effect
  memoization; add an explicit assertion when wiring the real consumer.)
- ✅ No `Effect.provide` in the consumer path — dependencies ride `Layer.provide` on each `serve`.
- ✅ **Docs:** `RESOURCE-API.md` section (`serve` / `httpServer` / `servedResourcesLayer` / `provide`) +
  a dedicated guide `docs/guides/per-resource-dependencies.md` (linked in the guides index).
- ✅ **Grouping helper shipped:** `Resource.provide(dependency, [resources])`.
- ⬜ **Deliberately not done — re-basing `serveAllHttp` as sugar (§5.3).** Evaluated and declined: it
  would need to absorb the Effect-form impls, host-status auto-mount, and readiness aggregate
  `serveAllHttp` already handles, and `serve` takes a *record* impl (not the Effect-form). Real risk to a
  core, widely-used function for marginal internal gain. The two stay complementary: `serveAllHttp` =
  shared-dependency serve; `serve` / `httpServer` = heterogeneous per-resource dependencies. Revisit only
  if the duplication becomes a maintenance cost.

## Resolved open questions (from §9)

- **Precise `R` typing:** solved via `ServeRequirements<Impl>` (extract from the impl value, not a
  mapped-type parameter).
- **Registry mechanism + ordering:** a `Ref`-backed accumulator (`ServedResources`) works; `serve`
  registers only if it's present (optional), and the `provideMerge` dependency chain guarantees every
  `serve` registers before `httpServer` reads — validated by `/health`.
- **Local-boot parallel:** none needed — `serve` is just a layer; a local runtime merges the same
  `serve` layers without `httpServer`.
- **The keep-it-alive detail:** consumers must `Layer.provideMerge` (not `Layer.provide`) the `serve`
  layers onto `httpServer`, else they're pruned as unused (they provide no service `httpServer`'s *type*
  requires — the handlers flow dynamically). Documented on `httpServer`; a missing handler fails the
  `RpcServer` at boot, not silently.
