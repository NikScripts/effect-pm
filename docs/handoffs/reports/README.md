# Agent reports — sync 2026-07-07

**Active agent handoffs:**

| Agent | Handoff | Scope |
|-------|---------|-------|
| 1 | [`agent-01-store-cutover-closeout.md`](../agent-01-store-cutover-closeout.md) | Store cutover — **merged** into `integration/storage` (2026-07-09) |
| 2 | [`agent-02-process-closeout.md`](../agent-02-process-closeout.md) | Process cast removal + stale docs |
| 2 | [`agent-02-branch-cleanup.md`](../agent-02-branch-cleanup.md) | Branch cleanup — **merged** (manifest on `integration/storage`) |

Work on **`integration/storage`**.

**Start here for merge context:** [`../integration-sync-2026-07-07.md`](../integration-sync-2026-07-07.md) — what landed, doc map, superseded notes, owner decisions.

## Hygiene

| Report | Scope |
|--------|-------|
| [Branch cleanup manifest](../branch-cleanup-manifest.md) | 2026-07-09 remote `cursor/*` audit — 18 merged branches deleted |

## Agent reports (review / blind spots)

| Report | Agent scope | Priority |
|--------|-------------|----------|
| [RunResource](./2026-07-07-agent-report-run-resource.md) | Gate handle, RPC, store tap, docs sweep | **Low** — mostly done; finish + verify |
| [Process](./2026-07-07-agent-report-process.md) | Tag wire slots, store contract cast, docs sweep | **Medium** — see [`agent-02-process-closeout.md`](../agent-02-process-closeout.md) |
| [QueueResource + CustomQueueResource](./2026-07-07-agent-report-queue-resource.md) | Engine cutover, triplet | **Low** — refreshed 2026-07-09; see integration-sync |
| [Store](./2026-07-07-agent-report-store.md) | Bridge typing, engine wiring gaps | **Medium** — Stage 1 details in store-cutover |
| [Docs + release](./2026-07-07-agent-report-docs-release.md) | Changesets, stale docs, examples README | **Medium** (after module PRs land) |

## Store cutover handoffs (engine wiring — authoritative)

| Doc | Owner |
|-----|-------|
| [Store core](../store-cutover-00-store-core.md) | Shared decisions — **read first** |
| [Process](../store-cutover-process.md) | Process engine → `tag.store` |
| [Queue](../store-cutover-queue.md) | `storeTap.ts` prototype + queue engine |
| [RunResource](../store-cutover-runresource.md) | Migrate off lazy tap |
| [CustomQueue](../store-cutover-customqueue.md) | Tag arity + inherits queue engine |

## Naming & RPC policy

- [`../2026-07-07-rpc-schema-names-payload-success-error.md`](../2026-07-07-rpc-schema-names-payload-success-error.md) — locked `payload` / `success` / `error`
- [`../result-schema-and-rpc-validation.md`](../result-schema-and-rpc-validation.md) — RPC fingerprint (deferred)

**Verify (all agents):**

```bash
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```
