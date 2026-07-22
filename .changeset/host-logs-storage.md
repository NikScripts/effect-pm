---
"hyperlink-ts": minor
---

**Durable log storage, queryable by host or by resource.** `HostLogs.persistLayer(host)` installs a
batched capture logger that durably stores every runtime log line in `LogStore` — bucketed by host,
with each line's `processId` / `queueId` annotation preserved — backed by `RuntimeStorage`
(memory / sqlite / redis via `ProcessStorage`). Read it back two ways:

- `HostLogs.byHost(host, opts?)` — every line a host logged;
- `HostLogs.byResource({ processId?, queueId? }, opts?)` — every line a specific queue/process logged,
  across hosts.

Both return `[]` (not an error) when nothing matches, newest first, and take `{ limit?, sort?, from?,
to? }`. The logger is installed at layer-build so it captures from the start (no relay-subscription
race), batching writes via `Stream.groupedWithin`. A host's served `HostStatus.logHistory` (what the
dashboard reads) is now backed by the same store.

This supersedes and removes the stranded, group-model log paths: `ProcessGroupLogContext` /
`layerProcessGroupLogContext` (never provided since process groups were removed) and the flat
`HostLogs.history` / `HistoryStore`-bucket persistence are gone; `LogAnnotationKeys` gains `host` (drops
`groupId`) and `withHostLogAnnotations`.
