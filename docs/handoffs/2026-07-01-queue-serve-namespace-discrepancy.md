# For effect-pm: the queue engine-`serve` isn't on the `QueueResource` namespace (beta.19)

> **✅ Fixed (option 1) — `QueueResource.serve` now resolves.** Re-exported `serve` through the
> `QueueResource` namespace (`src/internal/queueResourceNamespace.ts`), symmetric with
> `ScheduledProcess.serve`, so the changeset/example/docs are correct as written. **Released in
> `0.8.0-beta.20`** — bump your vendored effect-pm. Thanks for the precise report.

**Consumer:** wow-sports services-hub, adopting **beta.19** engine-aware serve to migrate our 9
`strictEffectProvide` sites. Small, specific finding — the feature works, but the documented API name
doesn't resolve.

## The discrepancy

The engine-serve changeset (`.changeset/engine-serve.md`) and the example both write the queue form as
**`QueueResource.serve`**:

```ts
QueueResource.serve(RosterQueue, rosterCfg).pipe(Layer.provide(emptyHookSource)),
```

But `QueueResource.serve` **doesn't exist**. Checked in beta.19:

- `QueueResource` namespace exports (dist): `serveHttp`, `server`, `serverEntry` — **no `serve`**.
- `ScheduledProcess` namespace exports: `serve`, `serveHttp`, `server`, `serverEntry` — the process form
  _is_ on its namespace, so the two are **asymmetric**.
- The queue `serve` actually lives in **`QueueContract.ts`** (`export const serve` ~L861), reachable only
  via the `@nikscripts/effect-pm/QueueResource` subpath — not re-exported through `QueueResource`.

So a consumer following the changeset/example hits `Property 'serve' does not exist on QueueResource`.

## The feature itself is fine

`QueueContract.serve` works on our `QueueResource.Tag`. Verified it typechecks against a real queue +
its existing `serverEntry` config:

```ts
import * as QueueContract from "@nikscripts/effect-pm/QueueResource";
QueueContract.serve(NwslRosterImportQueue, nwslRosterImportQueueConfig); // ✅ compiles
```

So this is purely a **naming / re-export** gap, not a functional one. `ScheduledProcess.serve` and
`Resource.httpServer` are exactly right; only the queue entry point is off.

## Ask (either is fine)

1. **Re-export `serve` through the `QueueResource` namespace** so `QueueResource.serve` matches
   `ScheduledProcess.serve` and the changeset/example — the least-surprise fix; consumers use
   `QueueResource` for `Tag`/`layer`/`serverEntry` already, so `serve` belongs there too. **or**
2. **Correct the changeset + example + any guide** to say `QueueContract.serve` (from
   `@nikscripts/effect-pm/QueueResource`), and note the asymmetry with `ScheduledProcess.serve`.

Preference is (1) — a one-line re-export keeps the toolkit symmetric and the docs already-correct.

_(Unrelated, already adopting: `ScheduledProcess.serve` + `httpServer([...])` for our WNBA import
pipeline; the NWSL/EBWSL sites turned out to be a simpler shared-handler hoist, not the mutually-exclusive
case — so only one of our three serves actually needs the new machinery. `fleetHealth` noted, thank you.)_
