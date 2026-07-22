---
"hyperlink-ts": minor
---

Rename the structured-logging symbols from the vestigial `ProcessManagerLog*` to neutral `Log*`
(no behavior change) — the log infra never depended on the removed `ProcessManager`:

- `ProcessManagerLogEntry` → `LogEntry`, `ProcessManagerLogEntrySchema` → `LogEntrySchema`,
  `ProcessManagerLogEntryNdjson` → `LogEntryNdjson`, `processManagerLogEntryFromLoggerOptions` →
  `logEntryFromLoggerOptions`
- `ProcessManagerLogRelay` → `LogRelay` (+ `LogRelayService`), `ProcessManagerLogAnnotationKeys` →
  `LogAnnotationKeys`
- `ProcessManagerLogQuery` → `LogQuery`, `ProcessManagerLogQueryError` → `LogQueryError`,
  `ProcessManagerLogSort` → `LogSort`, `ProcessManagerLogScope` → `LogScope`

The `LogEntry` namespace (`LogEntry.Schema` / `encode` / `decode`) is unchanged; the renamed entry
type now merges into it. Annotation key *values* (`groupId` / `processId` / `queueId`) are unchanged.
