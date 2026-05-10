# 01 — Naming & consistency contract

Non-negotiable: new code and docs must match this list.

## Runtime

- **ProcessGroup** — Orchestrator for processes + queues that belong together. This is the public API today (`ProcessGroup.make`, `serve`, `awaitShutdown`).
- **ProcessManager** — Reserved for a future multi-group coordinator across hosts (see `08-process-manager-future.md`). Not implemented.
- **Process** — Scheduled cron-backed effect.
- **QueueResource** / **QueueRef** — Managed queue and handle. Do not use `ResourcePool` naming.

## Analytics

- **ProcessStore** — Single event-first store (`append`, `appendBatch`, typed reads). Replaces `ExecutionHistory`.
- **PrismaProcessStore** — Optional persistence via `@nikscripts/effect-pm/prisma`.

## Banned

- `ExecutionHistory`, `PMError`, `AllManagedProcessesRequirements`, `ProcessManager` as the name of the in-process orchestrator (that role is **ProcessGroup**).
- Legacy queue spellings: `next`, `deffered`, `cache`, `refill` in new public API.

## Invariants

- No unsafe type casts at boundaries; narrow with predicates.
- Tagged errors (`Data.TaggedError`); no string throws across modules.
- JSON-serializable payloads in `ProcessStore`.
