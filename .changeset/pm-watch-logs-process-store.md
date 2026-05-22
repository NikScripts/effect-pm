---
"@nikscripts/effect-pm": minor
---

Add `pm watch` and `pm logs` operator commands with structured log annotations (`groupId`, `processId`, `queueId`). Child runtimes persist captured log lines to a file-backed `ProcessStore` under `.effect-pm/logs/<group>/events.ndjson`; `pm logs` queries that history by target (group, process, or queue) with date, cursor, limit, and sort flags.
