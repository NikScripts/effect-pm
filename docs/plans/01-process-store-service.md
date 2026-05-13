# 01 - ProcessStore as the storage service

## Status

Planned.

## Intent

Turn `ProcessStore` into the storage service it was meant to be: the stable
interface between `Process`, `QueueResource`, future resources, and whichever
storage implementation an application chooses.

The core package should provide a few useful implementations, but applications
must be able to write their own implementation without changing process or
queue code.

## Current gap

`ProcessStore` is currently shaped like append-only analytics:

- append process execution events,
- append process lifecycle events,
- append queue item / queue lifecycle events,
- read process execution and process lifecycle history.

It does not yet expose the broader storage boundary needed for queues,
resources, projections, subscriptions, or custom backends.

## Target model

`ProcessStore` becomes the durable event and projection boundary for runtime
activity.

It should own:

- process execution history,
- process lifecycle history,
- queue item history,
- queue lifecycle history,
- resource lifecycle history,
- projected summaries,
- optional event streaming,
- custom backend integration.

It should not own:

- user domain tables,
- mutable schedule truth by default,
- queue item payload storage unless an implementation explicitly chooses that,
- business-specific retry or dead-letter policy.

## Storage implementations

Provide:

- in-memory store for tests and examples,
- Prisma-backed store for durable SQL persistence,
- no-op store for applications that want zero persistence,
- test store with inspection helpers.

Leave room for:

- file-backed store,
- SQLite-specific store,
- remote store over HTTP/RPC,
- user-provided store with custom event routing.

## Interface direction

Keep the store event-first, but make reads first-class.

Candidate surface:

- `append(event)`
- `appendBatch(events)`
- `events(query)`
- `subscribe(query)`
- `getProcessExecutions(processId, opts)`
- `getProcessLifecycle(processId, opts)`
- `getQueueItems(queueId, opts)`
- `getQueueLifecycle(queueId, opts)`
- `getQueueSummary(queueId, opts)`
- `getResourceLifecycle(resourceId, opts)`
- `project(entity, opts)`

Queries should be typed and storage-neutral.

## Event envelope

Keep one envelope shape:

- `id`
- `type`
- `occurredAt`
- `entityType`
- `entityId`
- `attributes`
- payload-specific data

This keeps Prisma and custom stores simple while allowing new event types
without new storage tables.

## Queue persistence implication

`QueueResource` should not expose special `persist` and `refill` callbacks as
storage integration points.

Instead:

- built-in queue persistence is automatic when `ProcessStore` is available,
- user hooks receive queue-bound controls for custom lifecycle behavior,
- custom durable queue semantics are implemented by a custom `ProcessStore` or
  future queue storage implementation, not by special callback names.

## Schedule persistence boundary

Do not make `ProcessStore` the default mutable schedule database.

Schedule truth is domain state and should remain app-owned unless a separate
future `ProcessScheduleStore` is introduced. `ProcessStore` can record schedule
events and executions, but it should not silently become the source of truth for
what should run.

## Graduation criteria

- `ProcessStoreInterface` supports process and queue reads.
- Queue reads no longer require ad hoc store access.
- Prisma implementation supports the expanded interface.
- Queue persistence no longer depends on `persist`.
- Docs explain how to provide a custom store.
- Examples include memory, Prisma, and custom store wiring.
