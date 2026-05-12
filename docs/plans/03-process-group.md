# 03 — ProcessGroup (orchestrator)

## Role

`ProcessGroup` is the **unit of deployment**: one bundle of `Process` values and `QueueResource` tags that share lifecycle, the control HTTP server, and `ProcessStore` for analytics.

## API surface (current)

- Construction: `ProcessGroup.make({ queues, processes })`.
- Lifecycle: `start`, `stop`, `restart`, `startAll`, `stopAll`, `runImmediately`.
- Introspection: `status`, `processStatus`, `health`, `listQueues`, `getQueue`.
- Ops: `serve({ port })`, `awaitShutdown(options)`.

## Dependencies

- **ProcessStore** is required in the environment for scheduled processes and lifecycle recording (provide `ProcessStore.layer` or Prisma layer).

## Relationship to future ProcessManager

Multiple `ProcessGroup` instances on different hosts will be coordinated by a future **ProcessManager** (separate doc). That layer does not exist yet; do not overload `ProcessGroup` with cross-host concerns.
