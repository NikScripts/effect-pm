# 07 - ProcessManager

## Status

Deferred.

## Intent

Introduce a future top-level `ProcessManager` that coordinates many
`ProcessGroup` instances across hosts, tenants, or isolation boundaries.

`ProcessManager` is not the in-process orchestrator. That role remains
`ProcessGroup`.

## Responsibilities

Candidate responsibilities:

- discover process groups,
- aggregate process and queue status,
- route control commands to a target group,
- stream events from many groups,
- expose authenticated remote control,
- coordinate per-tenant or per-region operations,
- coordinate blue/green and staged deployment handoff,
- provide a single operations surface for many deployments.

## Non-goals

- Replace `ProcessGroup`.
- Own queue internals.
- Own schedule persistence by default.

The manager should orchestrate stable group and queue controls rather than
reaching into queue internals.

## Dependencies

This plan depends on clearer foundations:

- `ProcessStore` event and projection APIs,
- queue controls and hooks,
- control service v2,
- queue schema / enqueue / release controls,
- stable process/queue status contracts.

## Deployment handoff model

The intended deployment model:

1. deploy `ProcessGroup` version A,
2. deploy `ProcessGroup` version B alongside it,
3. keep B inactive or paused,
4. have the `ProcessManager` decide which group is active,
5. release pending queue work from A,
6. enqueue released work into B,
7. activate B,
8. drain or stop A.

This enables no-downtime updates. It also allows staged swaps: one process or
queue can move to a new deployment before another.

## Queue handoff requirements

Queue handoff depends on queue capabilities:

- source queue supports `release`,
- target queue supports metadata-aware `enqueue`,
- source queue can produce transferable entries,
- target queue validates entries with its own schema,
- validation failures are returned as structured enqueue errors,
- `ProcessStore` records release and rejection events.

The manager should treat released payloads as opaque. It should not need to
decode user payloads to move work between groups.

## Activation model

Groups need explicit activation state.

Candidate controls:

- `activate`
- `deactivate`
- `quiesce`
- `drain`
- `releaseAll`
- `capabilities`

Activation should be granular:

- whole group,
- individual process,
- individual queue,
- future resource types.

This supports staged rollout where queues and processes move at different
times.

## Capability model

The manager should discover what a group can do before issuing commands.

Candidate capability records:

- processes: start, stop, restart, run immediately, quiesce, schedule controls,
- queues: enqueue, release, pause, resume, drain, shutdown, schema version,
- resources: status, health, start, stop, release where supported.

Transport surfaces should all use the same capability model:

- local CLI,
- local HTTP,
- Effect RPC,
- web UI,
- ProcessManager.

## Transport questions

Open choices:

- Effect RPC,
- Effect HTTP,
- local agent plus remote manager,
- direct group-to-manager event forwarding,
- authentication and authorization model,
- versioning for remote group capabilities.

## Graduation criteria

- `ProcessGroup` remains embeddable and unchanged in concept.
- Remote protocol is schema-versioned.
- Manager can aggregate status from multiple groups.
- Manager can route process and queue controls safely.
- Manager can perform queue release / enqueue handoff between compatible
  groups.
- Manager can surface validation failures during handoff.
- Security model is documented before public release.
