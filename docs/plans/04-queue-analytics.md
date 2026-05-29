# 04 — Queue analytics

## Prerequisites (landed on integration branch)

- **`RuntimeStorage`** adapters (SQLite, Prisma), normalized rows, operational
  errors on facet reads — [STORAGE.md](../STORAGE.md)
- Dashboard / bundler guidance — [dashboard-integration.md](../guides/dashboard-integration.md)

## Target

After **`QueueResourceStore`** emits a complete concrete event story:

- Lifecycle + item trajectory events (**started**, **completed**, **retry**,
  **dead-letter**, **`release`** family, **`drained`**, …).
- **Facet-owned reads** — projections/summaries (depth, rates, SLA hints) beside
  raw **`facts`**/`query` APIs.
- **Live stream** hooks for dashboards (**SSE**/`Stream` adapters) consuming the
  same schema as persisted rows — not a parallel ad hoc metric API.

Depends on **`03-queue-remote-handoff.md`** emitting stable payloads.
