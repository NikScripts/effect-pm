---
"hyperlink-ts": major
---

Remove per-resource built-in log capture from queue/process/custom-queue handles.

- **Removed** `captureLogs` from `QueueResource` / `Process` layer config.
- **Removed** `logs.{stream,query}` from queue/process/custom-queue control specs and handles.
- **Removed** HistoryStore log fork paths (`${tag.key}/logs`); metrics history is unchanged.
- **Migrate** consumers to `Resource.logs(tag)` with `Logs.layer` + `Logs.persistLayer(node)` + `LogStore`, or remote dashboards via `NodeStatus.logs` + `LogEntry.hasKey(tag.key)`.

See `docs/LOGS.md` for the key catalog and migration patterns.
