# Architecture hub + RunResource vertical slice — main agent handoff

## Branch

**Implement on:** `cursor/hub-runresource-vertical`  
**Worktree:** `/Users/nikolasstow/Coding/packages/effect-pm-alt` (tmux: `effect-pm-alt`)

**Merge into (later):** `rewrite/store-transport` after transport agent lands — not an implementation branch.

Merge transport-unify work from the parallel agent (`cursor/transport-protocol-unify`)
after both pass CI — resolve conflicts in `src/index.ts`, `package.json` exports,
`tsup.config.ts` only.

## Role

**Primary implementer.** Owns the architectural split proof: **TelemetryHub**,
**RunResource** telemetry/archive/projection modules, and **telemetryTransport v1**
(live push without DB polling).

Do **not** re-implement store transport Protocol refactor or control HTTP cleanup —
parallel agent owns [`architecture-transport-unify-handoff.md`](./architecture-transport-unify-handoff.md).

---

## Read first (authoritative)

| Doc | Why |
| --- | --- |
| [`docs/recipes/architecture-split-and-transports.md`](../recipes/architecture-split-and-transports.md) | **Locked architecture** — steps 1–6; do not deviate without owner sign-off |
| [`docs/plans/20-process-store-split-and-telemetry.md`](../plans/20-process-store-split-and-telemetry.md) | Split rationale + migration phases |
| [`docs/plans/19-transport-boundaries.md`](../plans/19-transport-boundaries.md) | What belongs on each transport |
| [`docs/plans/17-facet-telemetry-factory.md`](../plans/17-facet-telemetry-factory.md) | Telemetry SSoT / wire derivation (target API) |
| [`docs/AGENTS.md`](../AGENTS.md) | Verification, Effect platform policy, public vs internal |
| [`docs/STORAGE.md`](../STORAGE.md) | Archive facet rules |
| Root [`AGENTS.md`](../../AGENTS.md) | Git commit policy |

---

## Current repo state (do not re-build)

| Already shipped | Where |
| --- | --- |
| Schema-typed archive queries (pilot) | `src/store/runResource.ts` — only fully migrated facet |
| Archive registry + `layerRemote` + store transport loop | `src/internal/store/service.ts`, `src/StoreTransportRpc.ts`, `src/internal/store/storeTransport.ts` |
| Store wire messages | `src/StoreMessage.ts` |
| Streaming + Ack on store client/server | store transport modules above |
| Control / log RPC adapters (legacy RpcGroup shape) | `src/ControlTransportRpc.ts`, `src/LogTransportRpc.ts` |
| Terminal contracts | `src/Terminal.ts` |

**Tests:** `pnpm test` — 370 passing at handoff time. `pnpm run typecheck` clean.

**Stale doc:** [`store-transport-rpc-handoff.md`](./store-transport-rpc-handoff.md) describes pre-ship work — ignore “what remains”; store transport is landed.

---

## Your slice order (6.1 → 6.2 → 6.3)

### 6.1 — `TelemetryHub` core

**Goal:** `yield* RunResourceTelemetry.State.Changed(...)` runs with **only**
`TelemetryHub` in `R` — no `RuntimeStorage`.

**Deliverables:**

- New subpath `@nikscripts/effect-pm/TelemetryHub` (or `src/TelemetryHub.ts`).
- `TelemetryHub` `Context.Service` — `emit` as functional `Effect` pipeline.
- Sink registration via composable layers (`TelemetryHub.sinkLayer`), not mutable
  runtime registry hacks.
- Sink dispatch by **wire id**; policies: persist = swallow+log (stub ok in 6.1),
  projection/broadcast = best-effort.
- **Zero imports** from `src/store/*` inside hub core.

**Pilot event stub:** one `RunResource` event (`State.Changed`) wired through hub —
full tree can follow plan 17 incrementally.

**Acceptance:**

- Test: emit with hub layer only → succeeds, no storage layer.
- Test: emit with zero sinks → succeeds.
- Kernel-type path: emit effect does not list `RuntimeStorage` in `R`.

### 6.2 — RunResource split + `ArchiveSink`

**Goal:** Telemetry SSoT separated from archive; persist is optional sink.

**Deliverables:**

- Domain folder (can land incrementally):

```text
src/store/runResource/
  telemetry.ts    # SSoT: State.Changed (+ Run.* as needed)
  archive.ts      # RunResourceStore — queries only, no telemetry section in builder
  projection.ts   # stub for 6.3
  index.ts        # RunResource namespace export
```

- `ArchiveSink.forStore(RunResourceStore)` — encoder **derived from event def**,
  not duplicate wire strings.
- Remove telemetry section requirement from archive builder for RunResource (or
  introduce `Archive.Service` alias — recipe allows `ProcessStore` shrink).
- Static emit on RunResource moves to telemetry tree → `TelemetryHub.emit`.

**Acceptance:**

- Test: emit + `ArchiveSink` → row in `RuntimeStorage`.
- Test: emit without archive layer → no storage, still succeeds.
- Changing event schema fails compile at emit + encoder + (later) reducer sites.

**Coordination:** Do not rename `StoreTransportRpc` → `storeTransport` — parallel agent.

### 6.3 — Live projection + `telemetryTransport` v1

**Status:** **Done** on `cursor/hub-runresource-vertical` (`60495a8`+).

**Goal:** **Actually live** — hub updates memory + pushes on wire; **no store poll
on hot path.**

**Deliverables:**

- `RunResourceProjection` service — start with `latestState(resourceId)`.
- `ProjectionSink.for(RunResourceProjection)` — reducer from `State.Changed` schema.
- `RunResourceProjection.layerHydrateFromArchive` — **one-shot** cold start from
  archive `latestState` / bounded `stateHistory`; not default on `Projection.layer`.
- `telemetryTransport` v1:
  - Path `/ws/telemetry` (may stub router mount until parallel agent merges Protocol
    unify — use in-process test protocol if needed).
  - `BroadcastSink` at app compose: hub → transport publish.
  - Schema-backed stream items (event wire + payload).

**Demo acceptance:** *(verified in `test/run-resource-projection.test.ts` and `test/telemetry-transport.test.ts`)*

1. Emit `State.Changed` → projection `latestState` updates in-process.
2. Telemetry transport client receives event **without** calling `storeTransport`.
3. Restart simulation: projection empty → provide hydrate layer → seeded from archive
   → subsequent emits update without polling loop.

---

## Design rules (locked)

- **Emit `R = TelemetryHub` only** at kernel sites.
- **Siloing** — opt-in layers/subpaths; no monolithic “all facets + all transports”
  unless explicitly named (`ProcessArchive.layerRuntimeStorage` = archives only).
- **SSoT** — one telemetry event def drives wire + encoder + reducer + broadcast.
- **Functional style** — hub dispatch via `Effect` combinators, not imperative loops.
- **No DB polling** for live UI — hydrate once, then hub-live.
- **PascalCase** types, **camelCase** modules/files matching main export (plan 19).

---

## Out of scope (defer)

- QueueResource migration (after RunResource vertical slice proves pattern).
- Plan 17 full wire-string break across all facets.
- `ProcessStorage` → `ProcessArchive` rename (slice 6.7 — parallel or follow-up).
- Demux single WebSocket.
- Strong persist-before-projection ordering.
- Dashboard React components.

---

## Verification (every commit slice)

```sh
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

Recommend **changeset** when public subpaths or exports change (owner approval before
committing changeset file if policy requires).

---

## Suggested commits

1. `feat(telemetry): add TelemetryHub core + wire-id sink layers`
2. `refactor(runResource): split telemetry from archive; ArchiveSink for State.Changed`
3. `feat(projection): RunResourceProjection + hydrate layer + telemetryTransport v1`

Push topic branch; open PR against `rewrite/store-transport` when 6.3 acceptance passes.
