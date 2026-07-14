# Adoption feedback: migrating off `strictEffectProvide` with beta.19/20 engine-serve

**Consumer:** wow-sports services-hub. Migrating our 9 in-body `Effect.provide` sites so we can set
`strictEffectProvide: "error"`. This is field feedback from _doing_ the migration — what worked and a
couple of small asks. Nothing here is a blocker.

> **Guidance gap (“when NOT to hoist”)** → [`open-asks.md`](./open-asks.md) §2.  
> **Shared majority + outlier on one port** → **shipped**: `Resource.provide` + isolated `serve` in
> the same `Resource.httpServer([...])` (`test/http-server-shared-and-isolated.test.ts`; readiness
> page). `serveAllHttp` retired — there is no second host API to mix into.

## What worked well

- **The whole loop.** beta.17 → beta.20 landed cleanly and additively — consumers stayed green with
  **zero changes** at every pull. The engine-serve (`ScheduledProcess.serve` / `QueueResource.serve`),
  `Resource.httpServer([...serves], options)`, and `Resource.fleetHealth` are exactly the shapes we
  asked for. The `QueueResource.serve` re-export fix shipped in the very next patch. The report → fix
  loop is working really well — thank you.
- `ScheduledProcess.serve(tag, config)` **preserves `R`** and runs the engine as advertised; verified it
  typechecks against our real configs.

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
