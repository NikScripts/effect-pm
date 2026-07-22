---
"@nikscripts/effect-pm": patch
---

Ship package subpaths that the barrel and docs already advertise.

Adds `package.json` `exports` + `tsup` entries for `./Polling`, `./LogEntry`, `./LogContext`, `./RunResource`, and `./HttpClientRunGate`, so deep imports like `@nikscripts/effect-pm/LogEntry` resolve to built artifacts instead of failing at install time.
