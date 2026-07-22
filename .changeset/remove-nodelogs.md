---
"hyperlink-ts": major
---

**Removed the `NodeLogs` compatibility shim (BREAKING).** Import `@nikscripts/effect-pm/Logs` instead (`import * as Logs from "@nikscripts/effect-pm/Logs"`). The `/NodeLogs` package subpath and barrel `NodeLogs` / `NodeLogEntry` re-exports are gone. Migration table: `docs/LOGS.md`.
