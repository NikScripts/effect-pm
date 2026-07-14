# Adoption feedback: migrating off `strictEffectProvide` with beta.19/20 engine-serve

**Consumer:** wow-sports services-hub. Migrating our 9 in-body `Effect.provide` sites so we can set
`strictEffectProvide: "error"`. This is field feedback from _doing_ the migration — what worked, one
ergonomic downside, and a couple of small asks. Nothing here is a blocker.

> **Guidance gap (“when NOT to hoist”)** moved to the priority queue:
> [`open-asks.md`](./open-asks.md) §2.

## What worked well

- **The whole loop.** beta.17 → beta.20 landed cleanly and additively — consumers stayed green with
  **zero changes** at every pull. The engine-serve (`ScheduledProcess.serve` / `QueueResource.serve`),
  `Resource.httpServer([...serves], options)`, and `Resource.fleetHealth` are exactly the shapes we
  asked for. The `QueueResource.serve` re-export fix shipped in the very next patch. The report → fix
  loop is working really well — thank you.
- `ScheduledProcess.serve(tag, config)` **preserves `R`** and runs the engine as advertised; verified it
  typechecks against our real configs.

## Ergonomic downside: one per-resource-dep resource forces the _whole_ serve off `serveAllHttp`

`serveAllHttp` and `httpServer` can't share a port (one `RpcServer`). So a serve that has **one**
resource needing per-resource deps has to convert **all** of its resources to `serve` layers under
`httpServer` — including the homogeneous majority (DB monitor, import monitor, ApiMetrics, the shared
workers) that were fine on `serveAllHttp`. `Resource.provide(sharedDep, [serve(a), serve(b), …])`
softens it (keeps the shared group together), but it's still a full rewrite of a working serve for the
sake of one outlier resource.

**Feature idea:** a `serveAllHttp` escape hatch — allow one (or a few) per-resource `serve` layer(s) to
be mixed into an otherwise-`serveAllHttp` host, so consumers don't rewrite a whole working serve to
isolate a single resource. If that's fundamentally impossible (one server, one registry), then explicit
guidance that "`httpServer` + `Resource.provide` groups is the migration target for the _entire_ serve"
would set expectations.

## Small asks

- **Test doubles for the served stack.** `serve`/`withImport`-style APIs make dependencies explicit in
  `R` (good), which means unit-testing a served resource now needs noop layers for its whole dep stack.
  Where effect-pm owns those services, shipping `layerNoop` / a "test serve" helper would save every
  consumer hand-stubbing them. (`ImportFlush.layerNoop` is great; more of that.)
- **`httpServer([...serves], options)` docs** — the array-sugar form is the ergonomic one; make sure the
  guide leads with it over the bare `provideMerge` assembly.

## Minor / self-inflicted

- Vendoring effect-pm as a **git subtree**, we hit add/add merge conflicts on the handoff docs when they
  were edited on both sides. That's our workflow's fault (we shouldn't commit into the subtree), not
  yours — noting only in case other subtree consumers hit the same and it's worth a line in the vendoring
  docs.

## Next for us

- The 2 WNBA source-provide sites → `httpServer` + `ScheduledProcess.serve` with the hooked source
  isolated on its own `Layer.provide` (will report if anything surprises).
- `Resource.fleetHealth` → rebuild the droplet-health board (our backlog #2) after the strict migration
  lands.
