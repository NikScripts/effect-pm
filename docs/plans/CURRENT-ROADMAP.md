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
- Initial multi-group `ProcessManager.cli([GroupA, GroupB])`.

Primary references:

- [07 - Typed ProcessGroup and remote ProcessManager](./07-process-manager.md)
- [05 - Control service v2](./05-control-service-v2.md)
- [PROCESS-API](../PROCESS-API.md)

## Phase B - Current polish

These are safe near-term improvements because they build on landed surfaces and
do not require queue schema/handoff work.

1. Harden multi-group CLI output and target resolution.
2. Use group contracts to gate CLI commands before HTTP calls.
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

1. Define runtime state, facts, and storage vocabulary.
2. Add an internal runtime observer for one low-risk runtime component.
3. Add scoped listener support.
4. Persist state changes/facts through the current store when available.
5. Add typed projections over state history.
6. Decide whether a lower-level storage dependency should be renamed or whether
   `ProcessStore` remains the public service name.

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

## Phase F - RemoteService and per-entry remote layers

This phase remains deliberately deferred.

Do not implement `Process.RemoteService`, `QueueResource.RemoteService`, or
`ProcessGroup.remoteLayers` until these are resolved:

- Lifecycle ownership for standalone process services.
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
  -> Phase C runtime state/facts
      -> Phase D queue schema/control v2
          -> Phase E remote enqueue + handoff
              -> Phase F RemoteService / remoteLayers
  -> Phase G lifecycle/hooks/strictness after state model stabilizes
```

## How to choose the next task

Prefer Phase B until the remote group and CLI surfaces feel solid. Then move to
Phase C. Avoid jumping to remote enqueue, handoff, or `RemoteService` until the
queue schema and runtime state foundations exist.
