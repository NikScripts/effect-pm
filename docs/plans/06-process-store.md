# 06 — ProcessStore (analytics)

## Current contract

- **Append path:** `append` / `appendBatch` with typed `AnalyticsEvent` union.
- **Core event types today:** `process.execution.completed`, `process.lifecycle.changed`.
- **Reads:** `getProcessExecutions(processId, opts?)`, `getProcessLifecycle(processId, opts?)` with `QueryOpts` (limit, before, after).

## Implementations

- **Memory** — `ProcessStore.layer` / `ProcessStore.memory()`.
- **Prisma** — `@nikscripts/effect-pm/prisma`: single `EffectPmEvent` envelope table; `npx effect-pm add prisma` for schema setup.

## Future extensions

Additional event types can reuse the same envelope row shape (payload JSON) without new tables if the schema stays envelope-first.

Queue-phase events belong here when **QueueResource** storage hooks land (`07-queue-resource.md`).
