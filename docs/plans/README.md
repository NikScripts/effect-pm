# effect-pm Future Plans

This directory is only for work that has **not** happened yet.

Implemented behavior, naming rules, public API reference, and operational
guidance belong in regular docs outside `docs/plans`. A plan graduates out of
this directory once the feature is implemented and the stable behavior is
documented elsewhere.

## Current plan set

Read these in order. The first plans build the storage and queue foundations
that later plans depend on.

| # | Plan | Purpose |
| - | ---- | ------- |
| 01 | [ProcessStore as the storage service](./01-process-store-service.md) | Turn `ProcessStore` into the durable service boundary for processes, queues, resources, and custom storage implementations. |
| 02 | [Queue controls and lifecycle hooks](./02-queue-controls-and-hooks.md) | Replace special `persist` / `refill` callbacks with queue-bound controls passed to effects and hooks. |
| 03 | [Queue analytics v2](./03-queue-analytics-v2.md) | Add first-class queue events, reads, projections, and summaries through `ProcessStore`. |
| 04 | [Schedule identity and persistence boundaries](./04-schedule-identity-and-persistence.md) | Clarify schedule persistence, stable IDs, DB sync, and removal cleanup. |
| 05 | [Control service v2](./05-control-service-v2.md) | Upgrade local control from a single command endpoint to a richer control and streaming surface. |
| 06 | [Process lifecycle hooks](./06-process-lifecycle-hooks.md) | Add process-level hooks without hiding user work under polling or schedule configuration. |
| 07 | [ProcessManager](./07-process-manager.md) | Future multi-group coordinator across hosts, tenants, or isolation boundaries. |
| 08 | [Lifecycle machine](./08-lifecycle-machine.md) | Explore an internal typed lifecycle kernel for queues, processes, schedules, and control eligibility. |
| 09 | [Strict any/unknown rule](./09-strict-any-unknown.md) | Re-enable `anyUnknownInErrorContext` when the queue/process typing boundary can support it. |

## Explicitly discarded from active planning

- Runtime-wide `ProcessEntry` target/live reconciler.
- Old `ProcessControl` design with `switchSchedule`, `sleepUntil`, and metadata setters.
- `Polling.cron`; cron belongs to schedule generation, not polling cadence.
- Dynamic `ProcessGroup.addProcess` / `removeProcess` until a future
  `ProcessManager` has a concrete ownership model.
- `serviceNotAsClass`; that language-service rule stays off unless project
  direction changes.

## Planning rules

- Keep plans future-only.
- Prefer one concept per file.
- Call out graduation criteria so implemented work can move into regular docs.
- Do not reintroduce the old reconciler framing unless the current
  schedule/polling runtime is explicitly redesigned.
