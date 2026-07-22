---
"hyperlink-ts": minor
---

Add `pm watch` and `pm logs` operator commands with structured log annotations (`groupId`, `processId`, `queueId`). Child runtimes persist captured log lines to a SQLite-backed `ProcessStore` at `.effect-pm/logs/<group>/logs.sqlite`; `pm logs` queries that history by target (group, process, or queue) with date, cursor, limit, and sort flags.

Unify operator lifecycle commands: `pm start <target>` and `pm stop <target>` dispatch by resolved identifier (group child launch/stop, process controls, or queue start). Remove `group-start`, `group-stop`, and `queue-start`.
