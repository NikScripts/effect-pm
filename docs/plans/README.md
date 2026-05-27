# effect-pm Future Plans

This directory is primarily for work that has **not** happened yet.

Implemented behavior, naming rules, public API reference, and operational
guidance belong in regular docs outside `docs/plans`. Some long-running plans
also include status notes for partially landed slices; treat those notes as
roadmap context, not as the source of truth for shipped APIs.

### Agent kickoff

| Artifact | Purpose |
| --- | --- |
| [**HANDOFF-grill-dashboard-wow-integration.md**](./HANDOFF-grill-dashboard-wow-integration.md) | Copy-paste prompt + checklist for grilling **WOW** (tRPC + Prisma) dashboard integration **before** a cheaper builder agent executes. |

## Current plan set

Plan numbers are stable references, not strict implementation order. For the
current execution order, status, and dependency phases, agents should start with
[CURRENT-ROADMAP.md](./CURRENT-ROADMAP.md) before choosing work from the
numbered plan details.

| # | Plan | Purpose |
| - | ---- | ------- |
| 02 | [Queue controls, schema, handoff, and lifecycle hooks](./02-queue-controls-and-hooks.md) | Define queue-bound controls, schema-driven enqueue validation, release/handoff envelopes, and lifecycle hooks. |
| 03 | [Queue analytics v2](./03-queue-analytics-v2.md) | Finish queue storage facets, concrete queue wire events, reads, projections, and summaries. |
| 04 | [Schedule identity and persistence boundaries](./04-schedule-identity-and-persistence.md) | Clarify schedule persistence, stable IDs, DB sync, and removal cleanup. |
| 05 | [Control service v2](./05-control-service-v2.md) | Track remaining local control work beyond the current contract-aligned REST surface. |
| 06 | [Process lifecycle hooks](./06-process-lifecycle-hooks.md) | Add process-level hooks without hiding user work under polling or schedule configuration. |
| 07 | [Typed ProcessGroup and remote ProcessManager](./07-process-manager.md) | Track typed group contracts and remaining remote `ProcessManager` work after the first implemented slices. |
| 07b | [ProcessGroup endpoint DX](./process-group-endpoint-dx.md) | Approved third-arg API (`Transport`, `Endpoint.local/production/define`), pre-1.0 **removals**, alternatives matrix, child launcher. |
| 08 | [Lifecycle machine](./08-lifecycle-machine.md) | Explore an internal typed lifecycle kernel for queues, processes, schedules, and control eligibility. |
| 09 | [Strict any/unknown rule](./09-strict-any-unknown.md) | Re-enable `anyUnknownInErrorContext` when the queue/process typing boundary can support it. |
| 11 | [Runtime state, listener hooks, history, and mutable config](./11-runtime-state-hooks-and-config.md) | Planned direction for state snapshots/history, external listeners, stable storage primitives, per-resource data, and config changes after start. |
| 12 | [Standalone instance spawns](./12-standalone-instance-spawns.md) | **`Process.spawn`** (multi-instance supervised processes outside **`ProcessGroup`**) plus **`suspend`/`wake`** vs schedule **`armed`**; mirrored **`QueueResource.open`** ergonomics and identity/logging conventions. |
| 13 | [ProcessManager log transport](./13-process-manager-log-transport.md) | Pluggable log egress/ingress (HTTP adapter refactor, **PubNub** live fan-out, **storage** cursor backfill via timestamps) on top of structured `ProcessManagerLogEntry` relay. |

## Historical implementation order

Use [CURRENT-ROADMAP.md](./CURRENT-ROADMAP.md) as the active execution order.
The sequence below is background context for how the numbered plans relate to
each other.

1. **Stabilize storage vocabulary** — Follow [STORAGE.md](../STORAGE.md): `ProcessStore` is the facet builder, `ProcessStorage` is the combined layer host, and each domain owns one facet.
2. **Define runtime state and signals** — Continue the still-relevant state/listener/config concepts from [11](./11-runtime-state-hooks-and-config.md) for one low-risk resource first.
3. **Redesign local group contracts** — Continue hardening the `ProcessGroup` declaration/contract shape in [07](./07-process-manager.md): canonical group/process/resource IDs, single entries tuple, typed local controls, and generated contract.
4. **Unify queue controls** — Use [02](./02-queue-controls-and-hooks.md) to align queue handles, schemas, release/handoff, and lifecycle hooks with the typed group contract.
5. **Expand queue analytics/projections** — Apply [03](./03-queue-analytics-v2.md) on top of the generic state/fact model instead of adding ad hoc store methods.
6. **Schedule identity** — Implement [04](./04-schedule-identity-and-persistence.md) so process state and group contracts can refer to stable schedule entries.
7. **Process hooks and lifecycle kernel** — Use [06](./06-process-lifecycle-hooks.md) and [08](./08-lifecycle-machine.md) once the state/signal vocabulary is real.
8. **Control service v2** — Continue [05](./05-control-service-v2.md) beyond the current contract-driven REST API with streaming/events and richer projections.
9. **Remote ProcessManager** — Continue the remote portions of [07](./07-process-manager.md): harden connection/CLI/layer behavior, then add schema-backed enqueue, deployment handoff, and richer multi-host coordination.
10. **Log transport** — After structured capture/relay is stable, implement [13](./13-process-manager-log-transport.md): transport port, storage `after` cursor history, then PubNub (depends on [11](./11-runtime-state-hooks-and-config.md) / storage adapters).
11. **Strict LS rule** — Re-enable [09](./09-strict-any-unknown.md) after the public boundaries are typed without broad `unknown` error channels.

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
