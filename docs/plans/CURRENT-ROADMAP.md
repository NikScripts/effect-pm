# Current roadmap

This file is the execution-order roadmap for the current branch. Numbered plans
remain stable references, not implementation order.

Use this file when deciding what to build next. Use the numbered plans for
details, constraints, and open questions.

## Phase A - Landed / stabilizing

These pieces are implemented on the current branch and should be hardened rather
than redesigned casually.

- `Process.Service` and `QueueResource.Service` canonical declarations.
- `ProcessGroup.make(id, entries)` for typed entry tuples.
- `ProcessGroup.Service(id, entries)` as the injectable group declaration.
- Typed process and queue group controls.
- Serializable group contracts with process and queue capability records.
- REST-first `ControlService` with `GET /contract`.
- `ProcessManager.connect(...)` remote clients.
- `ProcessManager.ConnectionRegistry.layer(...)`.
- `ProcessManager.ConnectionRegistry.layerConfig(...)`.
- Registry-backed `ProcessManager.Endpoint(Group)`.
- `ProcessGroup.remoteLayer(Group, Endpoint)`.
- Initial multi-group `ProcessManager.cli([GroupA, GroupB])` with `groups`,
  `ls`, `verify`, `status <target>`, process commands, queue commands,
  `--json` for read/verify commands, and local contract capability checks before
  remote controls.

Primary references:

- [07 - Typed ProcessGroup and remote ProcessManager](./07-process-manager.md)
- [05 - Control service v2](./05-control-service-v2.md)
- [PROCESS-API](../PROCESS-API.md)

## Phase B - Current polish

These are safe near-term improvements because they build on landed surfaces and
do not require queue schema/handoff work.

1. Polish multi-group CLI output, including the landed JSON output for `groups`,
   `ls`, `verify`, and `status <target>`.
2. Harden contract capability-gating diagnostics for CLI commands that fail
   before HTTP calls.
3. Keep endpoint/connection examples current.
4. Remove remaining old compatibility surfaces when no examples/tests depend on
   them.
5. Improve docs/examples around canonical ids and aliases.

Primary references:

- [07 - Typed ProcessGroup and remote ProcessManager](./07-process-manager.md)
- [05 - Control service v2](./05-control-service-v2.md)

## Phase C - Runtime state foundation

This phase should come before richer analytics, streaming, dashboards, or
mutable config.

Use [11](./11-runtime-state-hooks-and-config.md) as the active implementation
plan for this phase, and reconcile storage work with
[10](./10-process-store-phase-one.md) before adding public store methods.

1. Keep `ProcessStore` as the public storage service name for the first slice;
   `RuntimeRef`, `RuntimeStateBase`, `RuntimeStateChange`, `RuntimeFact`, and
   optional `RuntimeObserver` are now implemented without renaming storage.
   `ProcessStore` is the rich module-facing singleton facade; `RuntimeStorage`
   is the generic swappable storage boundary underneath it.
2. `RunResource` is the first observed runtime because it is a low-risk gate with
   no queue payloads, no schema work, and no background workers. It now publishes
   run started/completed/failed facts plus `RunResourceState` changes when
   `RuntimeObserver` is provided, supports scoped listener layers, and no-ops
   when it is absent.
3. `RuntimeObserver.layerProcessStore` now bridges runtime facts into
   `ProcessStore` as `runtime.fact.recorded` analytics events and state changes
   as `runtime.state.changed` analytics events.
4. `ProcessStore.events(query)` now reads `runtime.fact.recorded` and existing
   analytics events across memory, file-backed, and Prisma stores without
   feature-specific read methods.
5. The first file-backed `ProcessStore` adapter now uses Effect `FileSystem`;
   it is append-only and generic so it can later become a `RuntimeStorage`
   adapter.
6. Dedicated queue completion/lifecycle reads are now available across memory,
   file-backed, and Prisma stores. `ProcessStore.runtime.facts(query)` and
   `ProcessStore.runResource.history(...)` now prove typed projections can sit
   over generic event reads without adapter-specific APIs.
7. Keep `RuntimeStorage` planned as the generic storage port under
   `ProcessStore`, with memory/file-backed/Prisma adapters implementing that port
   rather than module-specific APIs.

Primary references:

- [11 - Runtime state, listener hooks, history, and mutable config](./11-runtime-state-hooks-and-config.md)
- [10 - ProcessStore read foundation](./10-process-store-phase-one.md)
- [01 - ProcessStore as the storage service](./01-process-store-service.md)

## Phase D - Queue v2 foundation

This phase is required before remote queue enqueue or release/handoff can be
honest.

1. Unify queue controls around a queue-bound control surface.
2. Add schema-backed `itemSchema` support where needed.
3. Add enqueue validation errors for single items and batches.
4. Replace broad public iterable enqueue input with single item / readonly array
   overloads.
5. Add contract metadata for queue item codecs.
6. Add release/handoff envelope design after schema-backed enqueue is stable.

Primary references:

- [02 - Queue controls, schema, handoff, and lifecycle hooks](./02-queue-controls-and-hooks.md)
- [11 - Runtime state, listener hooks, history, and mutable config](./11-runtime-state-hooks-and-config.md)

## Phase E - Remote enqueue and deployment handoff

Do not start this phase until Phase C and Phase D have enough implemented
surface to validate payloads and record state/facts.

Candidate work:

- `POST /queues/:id/enqueue`.
- Remote enqueue client controls.
- Queue `release` / `enqueueReleased`.
- Group activation, deactivation, quiesce, drain.
- Deployment handoff flows across old/new group endpoints.

Primary references:

- [07 - Typed ProcessGroup and remote ProcessManager](./07-process-manager.md)
- [02 - Queue controls, schema, handoff, and lifecycle hooks](./02-queue-controls-and-hooks.md)

## Phase E2 - Log transport (PubNub + storage history)

Build after the structured log relay is stable on the branch (capture →
`ProcessManagerLogEntry` → relay → operator replay). Does not require Phase D
queue schema work, but **storage backfill** should reuse Phase C storage/query
patterns rather than a one-off log database.

Candidate work:

1. **Log transport port** — Extract HTTP `/logs/stream` behind a
   `LogTransport`-style client/server (mirror control transport).
2. **Storage option** — Persist entries on child publish (`group.log.entry` via
   `ProcessStore.events`); operator uses **`--after`** (catch-up forward) or
   **`--before`** (scroll-back older than current tail) with **`entryId`** as the
   primary cursor, then optionally `--follow` on PubNub or HTTP.
3. **PubNub** — Publish NDJSON lines per entry on a group channel; operator
   subscribe feeds the same `decode → replayLogEntry` path (multi-host,
   multi-subscriber).

Primary references:

- [13 - ProcessManager log transport](./13-process-manager-log-transport.md)
- [07 - Typed ProcessGroup and remote ProcessManager](./07-process-manager.md)
- [11 - Runtime state, listener hooks, history, and mutable config](./11-runtime-state-hooks-and-config.md)

## Phase F - RemoteService and per-entry remote layers

This phase remains deliberately deferred.

Do not implement `Process.RemoteService`, `QueueResource.RemoteService`, or
`ProcessGroup.remoteLayers` until these are resolved:

- Lifecycle ownership for standalone process services (**see
  [12 - Standalone instance spawns](./12-standalone-instance-spawns.md)** for the
  designed **`Process.spawn` / **`QueueResource.open`** isolation model vs
  **`ProcessGroup`** fleet controls).
- Honest checked error channels for local and remote service handles.
- Queue `itemSchema` / codec contracts.
- Per-entry remote provider wiring.
- Capability typing for operations that are local-only or remote-only.

Primary references:

- [07 - Typed ProcessGroup and remote ProcessManager](./07-process-manager.md)
- [02 - Queue controls, schema, handoff, and lifecycle hooks](./02-queue-controls-and-hooks.md)

## Phase G - Lifecycle kernel, hooks, and strictness

This phase depends on runtime state and public API stabilization.

Candidate work:

- Lifecycle machine.
- Process lifecycle hooks.
- Queue lifecycle hooks backed by listeners.
- Schedule identity/persistence alignment.
- Re-enable strict any/unknown language-service rule.

Primary references:

- [08 - Lifecycle machine](./08-lifecycle-machine.md)
- [06 - Process lifecycle hooks](./06-process-lifecycle-hooks.md)
- [04 - Schedule identity and persistence boundaries](./04-schedule-identity-and-persistence.md)
- [09 - Strict any/unknown rule](./09-strict-any-unknown.md)

## Quick dependency graph

```text
Landed typed group + remote control
  -> Phase B CLI/control polish
  -> Phase E2 log transport (HTTP port, storage after-cursor, PubNub)  [can parallel late B]
  -> Phase C runtime state/facts
      -> Phase D queue schema/control v2
          -> Phase E remote enqueue + handoff
              -> Phase F RemoteService / remoteLayers
  -> Phase G lifecycle/hooks/strictness after state model stabilizes
```

Storage-heavy log backfill (Phase E2 slice 2) is easiest once Phase C query/append
patterns exist; PubNub live fan-out (slice 3) can land earlier behind the
transport port (slice 1).

## How to choose the next task

Prefer Phase B until the remote group and CLI surfaces feel solid. Then move to
Phase C. Avoid jumping to remote enqueue, handoff, or `RemoteService` until the
queue schema and runtime state foundations exist.
