# 05 - Control service v2

## Status

Planned.

## Intent

Upgrade the local control surface from a minimal command endpoint into a richer
operations API that can use queue/process controls and `ProcessStore`
projections.

## Current direction

Keep `ControlService` local-first. It should remain safe for application
embedding and not become the future multi-host `ProcessManager`.

Multi-group CLI UX belongs in `ProcessManager.cli(...)`, backed by a typed
connection registry. `ControlService` should keep serving one typed group per
localhost endpoint so applications can compose and expose groups explicitly.

## Target capabilities

Transport:

- keep localhost TCP support,
- consider Unix socket support,
- consider Effect HTTP server integration,
- keep authentication out of the first local-only pass unless transport expands.

Routes:

- `GET /health`
- `GET /processes`
- `GET /processes/:name`
- `POST /processes/:name/start`
- `POST /processes/:name/stop`
- `POST /processes/:name/restart`
- `POST /processes/:name/now`
- `GET /queues`
- `GET /queues/:name`
- `POST /queues/:name/pause`
- `POST /queues/:name/resume`
- `POST /queues/:name/clear`
- `POST /queues/:name/shutdown`
- `GET /events`

Live events:

- Server-Sent Events endpoint for process/queue store events,
- optional filtering by entity type/name,
- useful for dashboards and CLI watch mode.

## Queue control integration

Control service queue operations should use the public queue service controls,
not a private queue protocol.

If the queue service exposes an operation, the control service can delegate to
it. If an operation is not exposed by the queue service, the control service
should not invent it.

## ProcessStore integration

Control reads should prefer projections from `ProcessStore` where they provide
better history or summaries.

Runtime state still comes from live handles when needed.

## Graduation criteria

- `POST /control` is removed in favor of contract-aligned REST routes.
- REST-style routes are schema-validated.
- Queue endpoints use `QueueHandle` controls.
- Live events can stream store events.
- CLI can consume the new API.
