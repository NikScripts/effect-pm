---
"@nikscripts/effect-pm": minor
---

**Health board in the host die.** Tapping the host-status die now opens a triage board (reading every host's `HostStatus.resources[]`): any **degraded** resources across all hosts float to the top with their **root cause** — e.g. `BoxScoreQueue · connecting to scores DB…` — and tap a degraded row to jump straight to that resource's detail. The host roster (tap a host → its full screen) sits below. The degraded section self-hides when everything is healthy, so the board is quiet until something breaks. Pairs with dependency-aware readiness: when a queue depends on a database resource that blips, the queue shows up here as degraded "because" its dependency is.
