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
- provide a single operations surface for many deployments.

## Non-goals

- Replace `ProcessGroup`.
- Own queue internals.
- Own schedule persistence by default.
- Implement deployment handoff before there is a concrete product need.

## Dependencies

This plan depends on clearer foundations:

- `ProcessStore` event and projection APIs,
- queue controls and hooks,
- control service v2,
- stable process/queue status contracts.

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
- Security model is documented before public release.
