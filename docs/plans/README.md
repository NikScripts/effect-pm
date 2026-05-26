# Future roadmap (`docs/plans/`)

Everything here is **work not shipped yet**. Shipped APIs, behavior, and storage
facets belong in **`docs/*.md`** (especially [STORAGE.md](../STORAGE.md)),
**`docs/guides/`**, **`examples/`**, and source **TSDoc**.

Agents: read this README for **priority order**, then open the linked plan for
constraints and slicing.

---

## Priority order (do lower rows only when dependencies permit)

Higher items unblock remote operations, operator UX, and honest queue typing.

| Pri | Topic | Detail doc |
| --- | ----- | ---------- |
| 1 | **Remote controls & transport** — `ProcessManager`/CLI polish, configurable control listen/bind, optional `@effect/rpc` / ingress gates, injection of **`ControlTransportClient`** factories | [01-remote-cli-transport-wire.md](./01-remote-cli-transport-wire.md) |
| 2 | **ProcessGroup endpoint & child launcher DX** — third-arg `Transport`/`Endpoint.*`, removals, canonical vs alternatives | [process-group-endpoint-dx.md](./process-group-endpoint-dx.md) |
| 3 | **Queues: unified handles, schemas, remote enqueue & handoff** — `QueueResource`/`ProcessGroup` alignment, **`itemSchema`**, release/handoff, then remote enqueue over `ControlService`/`ProcessManager` | [03-queue-remote-handoff.md](./03-queue-remote-handoff.md) |
| 4 | **Queue analytics / projections / live reads** — `ProcessStoreQueueResource` completeness, dashboards | [04-queue-analytics.md](./04-queue-analytics.md) |
| 5 | **Log transport abstraction + durable history + live fan-out** — port like control transport, **`ProcessStoreLog`** cursors, optional PubNub | [05-log-transport.md](./05-log-transport.md) |
| 6 | **Runtime facets: listeners, history shape, mutable config** — beside [STORAGE.md](../STORAGE.md), no revived monolith facade | [06-runtime-hooks-config.md](./06-runtime-hooks-config.md) |
| 7 | **Schedule identity & persistence boundaries** — stable entry IDs, runtime sync/remove semantics | [07-schedule-identity.md](./07-schedule-identity.md) |
| 8 | **Lifecycle kernel & process hooks** — explicit transitions + **`Process`** extension hooks without hiding work under schedule/polling alone | [08-lifecycle-kernel-hooks.md](./08-lifecycle-kernel-hooks.md) |
| 9 | **`Process.spawn` / `QueueResource.open`** — multi-instance scripted supervision **outside** `ProcessGroup.make` tuples; blocks honest **`RemoteService` / per-entry remote layers** | [09-standalone-spawns.md](./09-standalone-spawns.md) |
| 10 | **TypeScript:** re-enable **`anyUnknownInErrorContext`** (keep **`serviceNotAsClass`** off) | [10-typescript-strict-unknown.md](./10-typescript-strict-unknown.md) |

### Dependency hints (soft)

```text
01 / process-group-endpoint-dx ─┬─► 03 queue remote + handoff
                                └─► 05 log transport (can overlap late 01)

06 runtime hooks ─► 04 analytics (facts stable first)
07 schedule identity ─► 08 lifecycle (clear IDs before machine)
03 ─► 09 RemoteService defer (queue contracts + spawn model)
```

---

## Planning rules

- One backlog file per topic; keep each **future-only** — when shipped, shrink
  the plan and move prose to **`docs/guides/`** or regular reference docs.
- Storage changes: [STORAGE.md](../STORAGE.md) is authoritative; facets live under
  `src/store/` with `store/<Domain>` subpaths.
- Public API changes: coordinate **changesets** when releasing.

---

## Explicitly discarded (do not resurrect without a new ADR)

- Runtime-wide **`ProcessEntry`** target/live reconciler.
- Old **`ProcessControl`** with **`switchSchedule`**, **`sleepUntil`**, metadata
  setters.
- **`Polling.cron`**; cron belongs on schedule generation, not polling cadence.
- **`ProcessGroup.addProcess` / removeProcess`** until **`ProcessManager`**
  ownership exists.
- Public generic **`RuntimeFact` / RuntimeRef`** vocabulary for new domains
  (**internal** envelopes may remain for narrow plumbing only).
