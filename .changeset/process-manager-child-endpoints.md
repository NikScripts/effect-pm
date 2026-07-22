---
"hyperlink-ts": minor
---

Replace module/runner endpoint shims with child-only `Endpoint.local(transport, entry)`, pipe child stdout/stderr into `.effect-pm/logs`, and add `pm watch` for live structured logs and `pm logs` for stored history.


Group `watch` streams structured Effect log entries over the control HTTP API (`/logs/stream`) and replays them through the operator logger layer, replacing file tailing of child stdout/stderr.
