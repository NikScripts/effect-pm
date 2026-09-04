# Handoff: Resource Host health/status — a readiness surface on the served Host

## Status & decided architecture (2026-06-29)

Reconciled with the `HostStatus` resource shipped since this handoff was written. **One readiness
model, multiple faces — no parallel `HostHealth` / `Resource.health`:**

- **Phase 1 — DONE.** `serveAllHttp` now mounts an always-on plain HTTP **`/health`** route
  alongside `/rpc` (`options.health.path` to relocate). The server answering proves it's listening,
  so it returns `200 { status:"ok", listening, resources:[{key,kind}], uptimeMillis, ts }` — the
  resource roster comes from the served entries (`Resource.kindOf` per tag). This unblocks the
  wow-sports deploy gate (`curl -sf /health`). Test: `test/host-health.test.ts`.
- **Phase 2 — DONE.** Per-resource readiness, derived from each resource's own status (SSOT), not a
  separate stored field:
  - **`Resource.withReadiness(tag, (svc) => Effect<{ ready, detail? }>)`** combinator (Effect-style,
    composed after construction — *not* a baked option, *not* a plugin array; the plugin idea was
    rejected as un-Effect-y, see the construction-shape decision). Contracts apply it from status:
    queue/custom-queue ready iff `phase === "running"`, scheduled-process iff `supervising`. Bare
    tags opt in the same way; absent ⇒ **ready by default**. Read via `Resource.readinessCheck`.
  - `serveAllHttp` runs ONE readiness pass over the served entries; both faces consume it:
    **`/health` → 503 / `status: "degraded"`** when any resource is down (body lists
    `{ key, kind, ready, detail? }`), and **`HostStatus`** gains `status` + `resources[]` from the
    same aggregate (no parallel `HostHealth`). Tests: `test/resource-readiness.test.ts`.
  - Resolved decisions held: `/health` always-on; not-ready ⇒ 503 with per-resource detail.
- **Phase 2.5 — DONE.** **Dependency-aware readiness.** A resource's readiness can compose other
  resources' readiness:
  - `withReadiness` derivations take the prior readiness as `base` (2nd arg) and **stack** — extend
    the factory's check (`yield* base` then AND deps) rather than replace it.
  - `Resource.readinessOf(tag)` pulls a resource's readiness by tag (yields its service + runs its
    derivation); used inside another resource's `withReadiness` to depend on it. Compile-time checked
    (the dep is in the readiness Effect's `R`) and works local *or* remote (re-derives from served
    status). `Resource.allReady([...])` ANDs checks (first not-ready wins).
  - **No `dependsOn` field, no graph extraction, no service/spec member** — readiness stays the SSOT
    derivation on the tag; the dependency is named once (in the readiness Effect, type-checked). We
    deliberately did **not** add runtime dependency validation (the type system + `Layer` already do
    it) — that would fight Effect.
  - **Acquisition (companion guidance, not API):** get hard dependencies ready by acquiring them
    eagerly with `Layer.scoped` (failures surface at boot; warm by first use; lean on the driver's
    lazy physical connections so no idle sockets). Go lazy only for conditional deps, single-flighting
    init with `Effect.cached` into the service's own scope. **`Layer` = "starts first"; readiness =
    "stays ready".** Tests: `test/resource-readiness.ts`.
- **Phase 3 — TODO (UI):** a dashboard **health board** reading the `HostStatus.resources[]` stream
  (the data is now there). Lowest priority per the original roadmap.

The original spec below is kept for context; where it says `Resource.health` / `HostHealth` /
"new schema", prefer folding into `HostStatus` per the above.

---


A `/health` (readiness) surface mounted by `serveAllHttp` per `Resource.Host`, aggregating the real
status of every served resource on that host. Plain `200/503` for dumb probes (deploy gates,
load balancers), plus a resource-aware JSON body for the dashboard/TUI **health board**. This is the
already-listed roadmap item — `docs/plans/README.md`: *"Resource Host health/status — a
health/status surface on `Resource.Host` / served instances (Host now exists, so this is
buildable)."* This handoff specs it.

## Why now (driving use case)

The control plane removal (plan 17) deleted `ControlService`, which used to serve `/health`. Nothing
replaced it, so **a served Host currently exposes `/rpc` but no readiness endpoint**. That's a real
regression for any deploy:

- wow-sports' deploy gate (`droplet-install.sh`) does a safe **delete-old → start-new →
  health-probe → revert-on-failure** cutover. The probe hits `http://127.0.0.1:<port>/health`. With
  `/health` gone, the migrated runtimes can't pass the probe, so **the hub is currently
  un-deployable through the safe pipeline** — the deploy starts the new release, the probe fails 30×,
  and it auto-reverts. Readiness on the Host is the linchpin that makes a safe rollout possible.
- The dashboard/TUI want an at-a-glance **health board** (already referenced in
  `docs/guides/toolkit-by-example.md`). Per-resource `status` exists; what's missing is the
  **aggregate, host-level readiness** view + a single HTTP endpoint to gate on.

## Design

Mount a `/health` route alongside `/rpc` in `serveAllHttp` (and `serveHttp`/`server`), bound to the
Host being served. It needs no new transport — it's a sibling route on the same `HttpServer` the
serve already owns.

Readiness is computed from state the toolkit already has:

- the `HttpServer` is actually listening,
- every served `ServeEntry` on the Host reports ready — reuse each resource's existing `status`
  (queue worker pool up / not shutting down; process driver supervising; durable/ history stores
  connected),
- optional consumer-supplied checks (DB reachable, credential present — e.g. a
  `WnbaCoreKeyHealthCheck`-style probe).

```
GET /health
  200  { status: "ok",       host, listening: true,  resources: [...], checks: [...], uptimeMs, ts }
  503  { status: "starting" | "degraded", ... }   // server not listening, a resource down, or a check failing
```

- **`status`**: `"ok"` (listening + all resources ready + all checks pass) · `"starting"` (server
  not yet listening or a resource still booting) · `"degraded"` (listening but a resource/check is
  failing).
- **`resources[]`**: `{ key, kind: "queue" | "process" | …, status, detail? }` — the per-resource
  readiness, keyed by the resource tag id (`key`, post the id→key rename). This is what the
  dashboard health board renders.
- **`checks[]`** (optional): results of consumer-supplied health effects.
- A `HEAD /health` (or `?probe=1`) that returns only the status code, for cheap liveness polling.

## API sketch

Health is on by default for a served Host (zero-config readiness), with an opt-in hook for extra
checks:

```ts
const Server = Resource.serveAllHttp(
  [QueueResource.serverEntry(QA, { effect }), ScheduledProcess.serverEntry(P, { … })],
  {
    // optional — app-specific readiness beyond resource status
    health: {
      path: "/health",                 // default "/health"
      checks: {
        db: Effect.gen(function* () { /* … */ return { ok: true } }),
      },
    },
  },
);
```

And a programmatic read for the dashboard/TUI client (so the board doesn't have to scrape HTTP):

```ts
// on the Host's served surface, mirroring `status` / `metrics`
Resource.health(SomeHost)        // Effect<HostHealth> — point-in-time
Resource.healthStream(SomeHost)  // Stream<HostHealth> — periodic, for the live board
```

`HostHealth` = a `Schema` of the JSON body above (counters/states encoded like the existing
`status`/metrics wire shapes), so it slices in the dashboard the same way.

## Readiness semantics (please get these right)

- **Readiness, not liveness.** Return `200` only when the host can actually serve — server
  listening *and* resources ready. A process that's up but whose queue worker pool hasn't started is
  `"starting"` (`503`), so a deploy gate won't promote a half-booted release.
- **`curl -sf /health` must work** as the contract — `-f` fails on `503`, which is exactly what the
  deploy probe relies on. No body parsing required for the gate.
- **Cheap.** The handler reads cached resource status; don't run the heavy consumer `checks` on
  every poll unless asked (cache with a short TTL, or only on `?deep=1`).

## Consumer integration (wow-sports, for reference)

- `scripts/deploy/health-probe.sh` repoints from the dead ControlService `/health` to this Host
  `/health` → the existing delete→start→**health**→revert cutover works end-to-end again.
- The dashboard renders a per-Host health pill from `Resource.healthStream`.
- A non-Host front (our static dashboard server on `:8080`) keeps a trivial `GET /` probe — it isn't
  a Host, so it's out of scope here.

## Open decisions for the author

1. **Default path + opt-out** — `/health` always-on, or only when `serveAllHttp` is given a `health`
   option? (Lean: always-on, since a served Host with no readiness is the footgun we're fixing.)
2. **Degraded vs starting status codes** — both `503`, or `degraded` → `200` with a body flag so a
   single sick resource doesn't fail the whole gate? (Lean: `503` for both — a deploy shouldn't
   promote a degraded host; the body says which resource.)
3. **Resource readiness source** — is per-resource `status` sufficient to derive "ready", or do
   queue/process need a dedicated `ready` boolean distinct from operational status?
4. **Wire schema home** — new `HostHealth` schema next to the status/metrics schemas; coordinate the
   shape with the dashboard so the board is free.

## Related

- `docs/plans/README.md` → "Resource Host health/status" (this item).
- `docs/handoffs/archive/2026-07/features/telemetry-resource.md` — the sibling ops surface (metrics). Health = readiness
  view, Telemetry = metrics view; both served per Host, both dashboard-native. Consider a shared
  "served ops surface" story.
- `docs/handoffs/archive/2026-07/features/ui-serve-all-http.md` — the serve surface this mounts onto.
- Requested by the wow-sports consumer (services-hub: three league Hosts + a web front); blocks a
  safe staged deploy of the hub dashboard.
