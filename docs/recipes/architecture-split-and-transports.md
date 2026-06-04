# Recipe: Architecture split & transports

## Goal

Lock architecture decisions that block the first implementation slices:

1. Split `ProcessStore` into **Telemetry / Archive / Projection** with honest deps.
2. Telemetry emits without storage via **hub + sinks**.
3. Four semantic transports + **one `RpcServer.Protocol`** (plan 19 + 20).
4. Define slice order after architecture is locked.

## Non-goals (this bake)

- Implementing slices (follow-on bake per slice).
- Dashboard React components.
- Plan 17 wire-string migration details (separate bake; depends on module split).
- JSON-RPC / Transferables.

## Mise en place

### Current coupling (repo facts)

- `ProcessStore.Service` **requires** telemetry + query sections; `make` merges emit
  + read and requires `RuntimeStorage` via spine (`src/internal/store/service.ts`).
- `storeTransport` uses `RpcServer.Protocol` directly (forked `StoreTransportProtocol` adapter deleted).
- `ControlTransportHttp` still exposes `GET /logs/stream` — duplicates log transport
  (plan 19).
- Plan 17 telemetry factory is designed but still modeled as a ProcessStore section.
- No facet uses `.resolveStream()` yet; streaming infra exists on store transport only.
- Branch: `rewrite/store-transport` — store transport reference impl landed; next work
  is split + transport convergence.

### Prior conversation (not yet locked in recipe)

- Transport boundaries: control / store / log / telemetry (+ terminal interface-specific).
- Telemetry without store: hub fan-out to optional persist / projection / broadcast sinks.
- Live projection reads on separate service tag from emit.
- One Effect `RpcServer.Protocol`; HTTP/WebSocket are adapters only.
- File naming: camelCase modules, PascalCase types (plan 19).

### Bake order (architecture pass)

| Step | Topic | Blocks |
| --- | --- | --- |
| **1** | Module split & public naming | Hub, archive extract, plan 17 target |
| 2 | TelemetryHub scope & sink model | Slice 1 (hub) |
| 3 | Archive vs projection lifecycle | Slice 2–3 |
| 4 | Unified Protocol topology | Transport refactor |
| 5 | Transport ↔ module mapping | Confirm plan 19 |
| 6 | First slice order & acceptance | Implementation start |

---

## Locked ingredients

### Step 1 — Module split & public naming (locked 2026-06-03)

- **Three modules per domain** — `Telemetry`, Archive (`*Store`), `Projection`; separate
  `Context.Tag`s and separate layers.
- **Keep `*Store` suffix** for archive facet classes (`QueueResourceStore`, `LogStore`);
  docs glossary: "archive facet."
- **`ProcessStore` shrinks** to archive builder + registry only (no telemetry section);
  implementation namespace may become `Archive`; `ProcessStore` alias OK short-term.
- **`ProcessStorage` → `ProcessArchive`** — merges archive layers only.
- **Plan 17 telemetry factory** targets top-level `Telemetry`, not `ProcessStore.telemetry(...)`.
- **Per-domain public namespace** — e.g. `QueueResource.{Telemetry, Store, Projection}`.
- **Siloing rule (cross-cutting)** — consumers carry only what they use:
  - separate `package.json` subpaths per module (`store/QueueResource`, telemetry tree,
    projection, each transport);
  - layers compose opt-in (`QueueResourceStore.layerRuntimeStorage` without
    `TelemetryHub`, without other facets);
  - no monolithic merge layer that pulls all facets + hub + transports unless explicitly
    named (e.g. `ProcessArchive.layerRuntimeStorage` = archives only, not telemetry);
  - registry / transport clients scoped to facets passed in (existing
    `ProcessStore.registry([RunResourceStore])` pattern extends to archives only).

### Step 2 — TelemetryHub scope & sink model (locked 2026-06-03)

- **Single global `TelemetryHub`** — one fan-out router; siloing via optional sink layers,
  not multiple hubs.
- **Emit `R = TelemetryHub` only** — kernel never requires `RuntimeStorage`, projection,
  or transport.
- **Sinks via optional `TelemetryHub.sinkLayer(...)`** — persist / projection / broadcast
  are independent layers beside their owner modules.
- **Sink subscription by wire id** — telemetry tree registers wires at module init; sinks
  opt in by wire; domains don't know which sinks exist.
- **Sink policies** — persist sink: `logWarning` + swallow (plan 17); projection +
  broadcast: best-effort default.
- **Hub subpath** `@nikscripts/effect-pm/TelemetryHub` — zero imports from facet modules;
  facets depend on hub, not vice versa.
- **Maintainability rule (cross-cutting)** — telemetry tree is **SSoT** per event (wire
  id + payload schema + API path); archive encoder, projection reducer, and broadcast
  payload derive from the same tree (plan 17 `Telemetry.Wire` / codec derivation — no
  hand-duplicated strings); sinks reference event defs, not copied wire constants.
- **Functional style** — hub `emit` as `Effect` pipeline; sink dispatch via
  `Effect.forEach` / combinator policies, not imperative app-level loops; sink registration
  via composable layers.

### Step 3 — Archive vs projection lifecycle (locked 2026-06-03)

- **Archive owns row codec + queries** — derived from telemetry event defs (plan 17); no
  hand-duplicated wire strings.
- **Projection owns reducers only** — `ProjectionSink` typed from same event schema as
  telemetry; separate `Context.Tag` from archive.
- **Emit never reads** — archive/projection reads are separate entry points.
- **Hydration explicit** — `*.layerHydrateFromArchive` optional layer; not default on
  `Projection.layer`.
- **Ordering: eventual default** — concurrent hub fan-out; projection/broadcast may lead
  persist; strong ordering deferred.
- **Domain folder co-location** — `telemetry.ts` / `archive.ts` / `projection.ts` per
  domain under e.g. `src/store/queueResource/`; subpaths stay granular.
- **Archive builder** — queries only (telemetry section removed from facet builder).
- **Projection runtime** — no archive reference; hydrate is composition-only.

### Step 4 — Unified RpcServer.Protocol topology (locked 2026-06-03)

- **Delete custom `*TransportProtocol` tags** — use `RpcServer.Protocol` /
  `RpcClient.Protocol` only; remove `layerProtocolFromRpc` bridges.
- **Path-scoped WebSocket v1** — `/ws/control`, `/ws/store`, `/ws/log`,
  `/ws/telemetry`; official `layerProtocolWebsocketRouter` + `layerNdjson`.
- **Per-transport `makeNo*` dispatch loops** — store transport is reference impl;
  control/log/telemetry converge to same shape; Effect owns wire framing
  (Ack/Chunk/Interrupt/…).
- **Siloed server/client layers** — each transport layer standalone; app merges
  only what it uses; shared serialization at app root.
- **Demux single-socket deferred** — future optimization if dashboard needs one WS.
- **camelCase transport modules** (`storeTransport.ts`) — PascalCase types only
  (plan 19); rename completed (`storeTransport`).

### Step 5 — Transport ↔ module mapping (locked 2026-06-03)

- **Four semantic transports** — control / store / log / telemetry; scope unchanged
  from plan 19.
- **Fifth: `terminalTransport`** (console/remote terminal) — interface-specific;
  bidirectional session I/O; **not** folded into control.
- **Module backing:**
  - `controlTransport` → `ControlRouter` / running group (mutations + live status)
  - `storeTransport` → `Archive.registry` + `RuntimeStorage` (durable reads/streams)
  - `logTransport` → `ProcessManagerLogRelay` (live structured logs only)
  - `telemetryTransport` → `TelemetryHub` broadcast sink (live facet events — **no DB
    polling**; projection updates via hub sink, UI subscribes on wire)
  - `terminalTransport` → `Terminal` session service (open/input/resize/events stream)
- **Durable `LogStore`** → store only; **live logs** → log only.
- **Live projections** → hub → `ProjectionSink` (memory) + optional `telemetryTransport`
  (remote subscribers); **never** store polling for “live.”
- **Dashboard composes thin clients** per need; hub→telemetry transport wired at app
  compose via sink layer.
- **Retire** `GET /logs/stream` from control HTTP; **no** log/history/terminal on control
  transport.
- **Terminal path v1:** `/ws/terminal` — same `RpcServer.Protocol` + official layers;
  siloed `terminalTransport.serverLayer` / client layer.

### Step 6 — First slice order & acceptance (locked 2026-06-03)

- **Slice order:** 6.1 Hub → 6.2 ArchiveSink → 6.3 Projection + telemetryTransport →
  6.4 store Protocol unify → 6.5 control/log dedup → 6.6 terminalTransport → 6.7
  ProcessArchive rename + domain folders.
- **Pilot domain: `RunResource`** (not Queue) — only facet with completed schema-typed
  archive migration; `latestState` / `State.Changed` ideal for first live projection.
  QueueResource follows after RunResource vertical slice proves the pattern.
- **Live projection model: hub-live + storage-hydrate (not poll):**
  - **Runtime:** hub → `ProjectionSink` → in-memory (`RunResourceProjection.latestState`);
    remote UI via `telemetryTransport` — **no DB polling on hot path**.
  - **Cold start:** explicit `RunResourceProjection.layerHydrateFromArchive` — one-time
    read from archive (`latestState` or bounded `stateHistory` scan) at layer init;
    storage seeds projection, then hub owns updates.
  - **Persist sink optional** on worker nodes; projection + telemetry transport can run
    on dashboard-facing node with hydrate + subscribe only.
- **Slice 6.3 proves:** `State.Changed` emit → projection updates → telemetry client
  receives event without `storeTransport` on hot path; after restart, hydrate restores
  state without polling loop.
- **Defer:** plan 17 full wire migration, demux WS, strong ordering, Queue facet
  migration, remaining transports beyond pilot paths.
- **Architecture bake complete** — next session: bake/implement **slice 6.1 (TelemetryHub)**.

---

## Open recipe steps

### Step 1 — Module split & public naming
**Locked** — see above.

### Step 2 — TelemetryHub scope & sink model
**Locked** — see above.

### Step 3 — Archive vs projection lifecycle
**Locked** — see above.

### Step 4 — Unified RpcServer.Protocol topology
**Locked** — see above.

### Step 5 — Transport ↔ module mapping
**Locked** — see above (includes `terminalTransport`).

### Step 6 — First slice order & acceptance
**Locked** — see above (`RunResource` pilot; hydrate-from-archive + hub-live).

---

## Rejected substitutions

_(record as we go)_

---

## Cleanup status

Architecture bake **complete** (steps 1–6 locked). Recipe stays open until slices
6.1–6.7 ship or decisions fold into `docs/plans/`.

**Handoff pointer for new session:** start with slice **6.1 TelemetryHub** bake or
implementation; read locked ingredients in this file + [`20-process-store-split-and-telemetry.md`](./plans/20-process-store-split-and-telemetry.md).
Pilot vertical slice: **RunResource** (`State.Changed` → `RunResourceProjection.latestState`).
