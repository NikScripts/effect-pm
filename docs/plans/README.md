# Future roadmap (`docs/plans/`)

Everything here is **work not shipped yet**. Shipped APIs, behavior, and storage
facets belong in **`docs/*.md`** (especially [STORAGE.md](../STORAGE.md)),
**`docs/guides/`**, **`examples/`**, and source **TSDoc**.

Agents: read this README for **priority order**, then open the linked plan for
constraints and slicing.

---

## Recently landed on the integration branch (documented elsewhere)

Shipped behavior belongs in [STORAGE.md](../STORAGE.md), [PACKAGE-GUIDE.md](../PACKAGE-GUIDE.md), and [guides/](../guides/) — not in plan files long-term.

- **Prisma `RuntimeStorage`**, operational storage errors, public `Xor` removed from `Query` — [STORAGE.md](../STORAGE.md), [MIGRATION-26b262b.md](../guides/MIGRATION-26b262b.md).
- **Export namespaces** and **ResourceConfigure** — [PACKAGE-GUIDE.md](../PACKAGE-GUIDE.md), [resource-configure.md](../guides/resource-configure.md).
- **Control protocol** (partial) — [control-plane.md](../guides/control-plane.md); remaining work in [01-remote-cli-transport-wire.md](./01-remote-cli-transport-wire.md).
- **Dashboard / bundler guidance** — [dashboard-integration.md](../guides/dashboard-integration.md), [service-tags-and-runtime-split.md](../guides/service-tags-and-runtime-split.md).

Follow-up storage polish: [11-storage-prisma-follow-up.md](./11-storage-prisma-follow-up.md).

---

## Priority order (do lower rows only when dependencies permit)

Higher items unblock remote operations, operator UX, and honest queue typing.

| Pri | Topic | Detail doc |
| --- | ----- | ---------- |
| 1 | **Remote controls & transport** — `ProcessManager`/CLI polish, configurable control listen/bind, optional `@effect/rpc` / ingress gates, injection of **`ControlTransportClient`** factories | [01-remote-cli-transport-wire.md](./01-remote-cli-transport-wire.md) |
| 2 | **ProcessGroup endpoint & child launcher DX** — third-arg `Transport`/`Endpoint.*`, removals, canonical vs alternatives | [process-group-endpoint-dx.md](./process-group-endpoint-dx.md) |
| 3 | **Queues: unified handles, schemas, remote enqueue & handoff** — `QueueResource`/`ProcessGroup` alignment, **`itemSchema`**, release/handoff, then remote enqueue over `ControlService`/`ProcessManager` | [03-queue-remote-handoff.md](./03-queue-remote-handoff.md) |
| 4 | **Queue analytics / projections / live reads** — `QueueResourceStore` completeness, dashboards | [04-queue-analytics.md](./04-queue-analytics.md) |
| 5 | **Log transport abstraction + durable history + live fan-out** — port like control transport, **`LogStore`** cursors, optional PubNub | [05-log-transport.md](./05-log-transport.md) |
| **5b** | **Transport boundaries** — what belongs in control / store / log / telemetry; shared control for CLI+dashboard; store-transport pattern for all; schemas everywhere; camelCase modules | [19-transport-boundaries.md](./19-transport-boundaries.md) |
| **5c** | **ProcessStore split** — `Telemetry.Service`, hub + sinks, telemetry state; archive vs projection; unified Protocol | [20-process-store-split-and-telemetry.md](./20-process-store-split-and-telemetry.md) · vocabulary [21](./21-state-vocabulary.md) · **bake** [telemetry-split-bake.md](../recipes/telemetry-split-bake.md) |
| **6a** | **Resource state scope** — process state (`State.Scope`); telemetry state (in-memory, telemetry-only) — [21](./21-state-vocabulary.md) | [18-resource-state-scope.md](./18-resource-state-scope.md) |
| **6b** | **Facet telemetry factory + scope** — §5 facet DX finalized; slice 3 = `ProcessExecutionStore` + `ProcessScope` + `Process.ts`; then other facets; see [18](./18-resource-state-scope.md) | [17-facet-telemetry-factory.md](./17-facet-telemetry-factory.md) |
| 6 | **Runtime facets: listeners, history shape, mutable config** — beside [STORAGE.md](../STORAGE.md), no revived monolith facade | [06-runtime-hooks-config.md](./06-runtime-hooks-config.md) |
| 7 | **Schedule identity & persistence boundaries** — stable entry IDs, runtime sync/remove semantics | [07-schedule-identity.md](./07-schedule-identity.md) |
| 8 | **Lifecycle kernel & process hooks** — explicit transitions + **`Process`** extension hooks without hiding work under schedule/polling alone | [08-lifecycle-kernel-hooks.md](./08-lifecycle-kernel-hooks.md) |
| **8b** | **Runtime identity & singleton runs** — `instanceId`, in-process + **storage-backed** duplicate prevention, `ProcessGroup` definition validation | [12-runtime-identity-and-singleton-runs.md](./12-runtime-identity-and-singleton-runs.md) |
| **8c** | **Queue `rateLimit` + operational storage** — Effect limiter, `RateLimiterStore`, `transaction`, extend **`configure`/`Service`** on Process/Run/HttpApi | [13-queue-rate-limit-and-operational-storage.md](./13-queue-rate-limit-and-operational-storage.md) |
| 9 | **`Process.spawn` / `QueueResource.open`** — multi-instance scripted supervision **outside** `ProcessGroup.make` tuples; blocks honest **`RemoteService` / per-entry remote layers** | [09-standalone-spawns.md](./09-standalone-spawns.md) |
| 10 | **TypeScript:** re-enable **`anyUnknownInErrorContext`** (keep **`serviceNotAsClass`** off) | [10-typescript-strict-unknown.md](./10-typescript-strict-unknown.md) |
| — | **Storage / Prisma follow-up** (adapter landed; polish and docs) | [11-storage-prisma-follow-up.md](./11-storage-prisma-follow-up.md) |
| — | **Hybrid `RuntimeStorage`** — one layer, SQL + Redis inside adapter | [15-runtime-storage-hybrid.md](./15-runtime-storage-hybrid.md) |
| — | **Transport implementation migration** — reframe Effect RPC as wire framing only; rebuild control/log on store-transport shape; HTTP/WebSocket adapters | [16-effect-rpc-transport-migration.md](./16-effect-rpc-transport-migration.md) · boundaries [19](./19-transport-boundaries.md) |
| — | **Effect ecosystem adapters** — `@effect/sql` substrate hardening; optional `@effect/workflow` / `@effect/cluster` compose adapters | [22-effect-ecosystem-adapters.md](./22-effect-ecosystem-adapters.md) |
| — | **Conversation index (May 2026)** — checklist; not implementation spec | [14-conversation-capture-may-2026.md](./14-conversation-capture-may-2026.md) |

### Dependency hints (soft)

```text
01 / process-group-endpoint-dx ─┬─► 03 queue remote + handoff
                                └─► 05 log transport (can overlap late 01)

06 runtime hooks ─► 04 analytics (facts stable first)
07 schedule identity ─► 08 lifecycle (clear IDs before machine)
12 identity / leases ─► 09 spawn + cross-host start honesty
13 transaction ─► 13 rateLimit + 12 storage leases (shared RuntimeStorage.transaction)
03 ─► 09 RemoteService defer (queue contracts + spawn model)
```

**May 2026 design capture:** plans **12–14** record identity, queue rate limit,
and thread decisions. Resolve **12 § Deferred** before implementing leases or
spawn; green-light **13** rate limit separately if desired.

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
