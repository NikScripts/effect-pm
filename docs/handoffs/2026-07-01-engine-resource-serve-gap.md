# For effect-pm: `serve`/`httpServer` must run **engine** resources (queues/processes) — + open wow-sports asks

> **✅ Resolved:** `QueueResource.serve(tag, config)` and `ScheduledProcess.serve(tag, config)` — the
> engine-running `serve`-style layers you asked for. They run the worker/refill/persist (queues) or tick
> schedule (processes) engine, mount the RPC handlers, register into `servedResourcesLayer`, **and
> preserve the engine's requirement `R`** so a per-resource `Layer.provide` isolates it — composed under
> `Resource.httpServer` exactly as your example. Mechanism: `Layer.unwrap(Effect.map(buildXImpl(tag,
> config), (impl) => Resource.serve(tag, impl)))` (same shape as the existing `serveHttp`). Proven in
> `test/engine-serve.test.ts` — two processes' ticks fire, each seeing its own `Dep`. **You can now
> migrate all 9 engine sites and graduate `strictEffectProvide → "error"`.** The backlog below (telemetry,
> fleet-health, etc.) is unchanged.

**Reply to** [`per-resource-dependency-serve-design.md`](./per-resource-dependency-serve-design.md) and
the note back [`2026-07-01-per-resource-dependency-for-wow.md`](./2026-07-01-per-resource-dependency-for-wow.md).
**Consumer:** wow-sports services-hub, evaluated against **beta.18** (released `4dba929fe`; we vendored
`8304d519` just before the tag).

Thank you for the per-resource-dependency serve — it's exactly the right shape. But when we went to adopt
it against our 9 `strictEffectProvide` sites, we hit a gap: **all 9 are engine resources** (7
`ScheduledProcess`, 2 `QueueResource`), and the shipped `serve`/`httpServer` serves **raw query
resources only** — it doesn't run the queue-worker / process-tick engine. So the migration in the
note-back can't be done as written. Details + proof below, then the rest of our open backlog.

---

## The gap (with proof)

The note-back's migration is:

```ts
Resource.serve(NwslGetSeasonMatches, { run: nwslGetSeasonMatchesTick }).pipe(
  Layer.provide(NwslHub.processTickHandlersLayer),
);
```

That shape does **not** exist in the shipped API. `Resource.serve(tag, impl)` takes `ServeImplOf<S>` —
the tag's **query handlers** — and a `ScheduledProcess` tag's serve methods are
`statusNow` / `status` / `schedule` / `logs` / `logHistory`. There is **no `run`**. The exact example
fails to typecheck:

```
error TS2353: Object literal may only specify known properties, and 'run' does not exist in type
'ServeImplOf<{ statusNow: …; status: …; schedule: …; logs: …; logHistory: … }>'.
```

Three independent confirmations that `serve` is query-only, engine-less:

1. **No `QueueResource.serve` / `ScheduledProcess.serve`** (checked in the released beta.18). Only the
   pre-existing `serverEntry` — which _does_ run the engine, but only under `serveAllHttp`'s single shared
   union-provide (the thing our original report couldn't use).
2. **`serve`'s implementation runs no engine.** It builds `group.toLayer(handlers)` + a registry
   `register(...)` and returns — no worker, no refill, no `persist`, no tick schedule. `ScheduledProcess`
   even documents it: _"the light `Tag`/spec never pulls the engine that `layer`/`server`/`serveHttp`
   use."_ `serve` uses the light tag, so it gets handlers, not the engine.
3. **Both shipped beta.18 tests** (`multi-resource-isolated-deps`, `multi-resource-http-server`) serve
   only raw `Resource.Tag`s with a `read` query — never a queue or process.

**Consequence for us:** swapping `QueueResource.serverEntry(RosterQueue, cfg)` →
`Resource.serve(RosterQueue, …)` would mount the RPC surface but **stop the worker/refill/persist** — a
broken deploy and a dead ingest pipeline. So we can't graduate `strictEffectProvide → "error"` yet;
it stays parked exactly where it was before beta.18, one iteration closer.

## What we need — `serve` for engine resources

The same isolation you built for raw resources, but the served layer also **runs the engine** and
**preserves the engine's requirement `R`** so a per-resource `Layer.provide` discharges it. Concretely,
either:

- **`QueueResource.serve(tag, config)` and `ScheduledProcess.serve(tag, config)`** — mirror `serverEntry`
  (worker + refill + `persist` + `captureLogs` for queues; tick schedule for processes), but as a
  **`serve`-style layer**: preserves the worker/tick body's `R`, and `register`s into
  `servedResourcesLayer` so `httpServer` mounts `/rpc` + `/health` for it. Then we compose exactly like
  the raw case:

  ```ts
  Resource.httpServer({ health: { path: "/health" } }).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        // bare-client ticks: share the stateless handler registry
        Resource.provide(processTickHandlersLayer, [
          ScheduledProcess.serve(GetSeasonMatches, seasonMatchesCfg),
          ScheduledProcess.serve(LiveScorePoller, pollerCfg),
        ]),
        // phased import: the HOOKED source, isolated on its own provide (no double-enqueue)
        ScheduledProcess.serve(IncrementalSeasonImport, importCfg).pipe(
          Layer.provide(hookedSourceLayer),
        ),
        // queue workers: the EMPTY-hook source
        Resource.provide(emptyHookSourceLayer, [
          QueueResource.serve(RosterImportQueue, rosterCfg),
          QueueResource.serve(TeamMediaImportQueue, mediaCfg),
        ]),
      ),
    ),
    Layer.provide(Resource.servedResourcesLayer),
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  );
  ```

- **or** let `Resource.serve` accept an engine `config` for queue/process tags (detected via `kindOf`)
  and run it — same effect, fewer names.

The crux for us is exactly the mutually-exclusive case your design targets, but on the **`ImportSource`
tag**: our phased-import process needs the **hooked** source (`afterEachPersistedRow` enqueues follow-up
media/roster work); the queue **workers** need the **empty-hook** source. Same tag, two impls — a single
shared provide double-enqueues. Per-resource `serve` layers make that a compile-time isolation, but only
if `serve` runs the engine.

`serveAllHttp` stays perfect for the homogeneous majority (Database, Import, ApiMetrics, media queues that
share the empty-hook source) — we'd only reach for `serve`/`httpServer` on the heterogeneous-source subset.

---

## Still open — the rest of the wow-sports backlog

Not blockers for beta.18; captured so the picture is complete. (The queue **startup hook** and dashboard
**custom-resource widgets** you just logged are already tracked separately — thank you.)

1. **Telemetry resource** — distributed, dashboard-native metrics
   ([`telemetry-resource.md`](./telemetry-resource.md), design-only; not in `src`). Every host serves its
   metrics; dashboard/TUI fans out across all hosts (incl. remote) and aggregates overall / per-host /
   per-label. This is what turns the shipped `ApiMetrics` (and queue/process metrics) into a real
   fleet-wide panel rather than per-process registry emission. Highest-value of the remaining asks.

2. **Fleet-health helper** (new, from the multi-host follow-up) — the "fold each peer's status into a
   `byHost` health view + add self via `selfHost`" pattern is generic; every consumer that wants a
   droplet-health table hand-rolls the same `combineQuery(peers, …, Combine.byHost)` + `selfHost` fold.
   A canned helper (e.g. `Resource.fleetHealth(tag, pick)`) on top of the beta.17 primitives would save
   every consumer that boilerplate. Low priority; the primitives already work.

3. **Queue-persistence deferred tiers** ([`queue-persistence-design.md`](./queue-persistence-design.md)) —
   multi-worker lease / visibility-timeout refinement, and metrics **downsampling** (1s→1m→1h). Explicitly
   deferred; single-host at league scale is fine, so no urgency.

4. **Docs** ([`docs-updates.md`](./docs-updates.md)) — `serveAllHttp` + `QueueResource.serverEntry` /
   `ScheduledProcess.serverEntry` still lack a dedicated guide section (they appear only in `AGENTS.md`
   and handoffs). The new `per-resource-dependencies.md` guide is great; the base serving path deserves
   the same treatment, and — once engine-`serve` lands — a note on when to use which.

_Resolved since our last round (thank you): `withReadiness` on host-bound tags (#29, beta.16),
`selfHost` / `peersLayer({url})` / `client(tag, host)` (beta.17), the raw-resource per-resource-dependency
`serve`/`httpServer` (beta.18). Only the **engine**-resource case above remains for the strict graduation._
