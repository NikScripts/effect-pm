# 03 - Queue analytics v2

## Status

Planned.

## Intent

Make queue observability first-class through `ProcessStore`.

Queue runtime should automatically write meaningful queue events when a
`ProcessStore` implementation is available. Applications should not need a
custom persistence hook to learn what happened inside a queue.

## Current gap

Queue item and lifecycle events exist, and `QueueResource` writes some of them
when a store is available. The read side is incomplete:

- Queue storage has moved to per-domain facets; `ProcessStoreInterface` no longer exists.
- Queue item events do not yet capture the full lifecycle.
- There are no first-class queue projections or summaries.
- There is no event stream for live dashboards.

## Target event model

Candidate queue events:

- `queue.lifecycle.started`
- `queue.lifecycle.paused`
- `queue.lifecycle.resumed`
- `queue.lifecycle.shutdown`
- `queue.lifecycle.cleared`
- `queue.item.enqueued`
- `queue.item.enqueue_rejected`
- `queue.item.started`
- `queue.item.completed`
- `queue.item.failed`
- `queue.item.retry.scheduled`
- `queue.item.retry.exhausted`
- `queue.item.dead_lettered`
- `queue.release.requested`
- `queue.release.completed`
- `queue.release.failed`
- `queue.empty`
- `queue.drained`

Event payloads should include, where available:

- queue name,
- entry id,
- item key,
- release id,
- source group / deployment metadata,
- priority,
- attempt number,
- enqueue timestamp,
- start timestamp,
- completion timestamp,
- duration,
- error/cause string,
- lifecycle state,
- validation diagnostics,
- hook/source metadata.

If an `onEmpty` or `onDrained` hook adds more work, that follow-up work should
be represented by normal enqueue events. Do not introduce a special refill event
unless a later plan adds a distinct runtime-managed refill feature.

## Read model

Add queue reads to `ProcessStore`:

- `getQueueItems(queueId, opts)`
- `getQueueLifecycle(queueId, opts)`
- `getQueueEnqueueRejections(queueId, opts)`
- `getQueueReleases(queueId, opts)`
- `getQueueSummary(queueId, opts)`
- `getQueueFailures(queueId, opts)`
- `getQueueDeadLetters(queueId, opts)`
- `getQueueThroughput(queueId, opts)`

Projection candidates:

- current lifecycle state,
- pending/in-flight/completed counts,
- failure rate,
- retry rate,
- exhausted count,
- validation rejection count,
- release success / failure count,
- average processing duration,
- enqueue-to-start latency,
- throughput by priority,
- last enqueue / completion / failure timestamps.

## Dashboard and control use cases

Queue analytics should support:

- CLI status,
- future HTTP status routes,
- future SSE live events,
- operations dashboards,
- tests that assert lifecycle event order,
- replaying queue history after process restart.

## Relationship to hooks

Hooks are power-user extension points. Queue analytics is automatic runtime
behavior.

Hook failures must not prevent analytics events from being recorded. Analytics
events should describe what the runtime observed, not what hooks chose to do.

## Graduation criteria

- Queue read APIs exist on `ProcessStoreQueueResource`.
- Memory and Prisma stores implement queue reads.
- Queue events cover enqueue, start, completion, retry, exhaustion, and
  lifecycle transitions.
- Queue events cover schema validation rejection and release / handoff events.
- Queue status can be projected from store events.
- `ControlService` can read queue history without knowing queue internals.
