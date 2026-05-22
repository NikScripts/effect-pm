---
"@nikscripts/effect-pm": minor
---

Replace module/runner endpoint shims with child-only `Endpoint.local(transport, entry)`, pipe child stdout/stderr into `.effect-pm/logs`, and add `pm group-logs` to tail or follow group log files from run state.
