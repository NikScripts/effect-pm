---
"hyperlink-ts": minor
---

**Logs / identity:** `Logs.byResource` takes a scope tag or full `Tag.key` (mirror `byNode`) — the `{ processId?, queueId? }` bag is gone. Drop legacy `LogAnnotationKeys.processId` / `queueId` and `withProcessLogAnnotations` / `withQueueLogAnnotations`; lineage is lineage-only. CLI log scope/query filters by resource `key` via `LogEntry.hasKey`. Process execution events and queue analytics/durable-queue surfaces rename resource-identity `processId` / `queueId` fields to `key` (`groupId` RPC wire prefix unchanged).
