---
"@nikscripts/effect-pm": minor
---

Replace module/runner endpoint shims with child-only `Endpoint.local(transport, entry)`, pipe child stdout/stderr into `.effect-pm/logs`, and add `pm group-logs` to tail or follow group log files from run state.


Group `group-logs` now streams structured Effect log entries over the control HTTP API (`/logs/stream`) and replays them through the operator logger layer, replacing file tailing of child stdout/stderr.
