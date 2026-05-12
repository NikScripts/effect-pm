# 02 — Implementation status

## Done (as of current `main` work)

- **ProcessGroup** — Lifecycle, queues, HTTP control, shutdown signals; orchestrates one deployable bundle.
- **Process** — Cron scheduling, `runImmediately`, status; writes execution events to **ProcessStore** when provided.
- **QueueResource** — Priorities, concurrency, handler-driven retry, deduplication, lifecycle hooks, pause/resume/shutdown/clear.
- **ProcessStore** — In-memory layer; event types `process.execution.completed`, `process.lifecycle.changed`.
- **Prisma** (if merged) — Subpath adapter + `effect-pm` CLI for schema fragment; optional peer `@prisma/client`.

## Not done yet

- **ProcessEntry** map + reconciler (target vs live, `computeDiff` / `applyDiff`).
- **Process** variants (no-schedule / single / multi-schedule with typed keys) and **ProcessControl** in-effect API.
- **Top-level ProcessManager** — Multi-group RPC/HTTP coordinator (deferred).

## Out of scope

- Deploy / handoff between deployments (document elsewhere if needed).
