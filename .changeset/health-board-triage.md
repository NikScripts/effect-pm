---
"@nikscripts/effect-pm": minor
---

**Full-screen health board.** Tapping the host-status die now opens a full-screen health board (reading every host's `HostStatus.resources[]`):

- a top **stat strip** — hosts ok, resources ready, needs-attention count;
- **needs attention** — every **degraded** resource across all hosts, each with its **root cause** (e.g. `BoxScoreQueue · connecting to scores DB…`); tap a row to jump straight to that resource's detail;
- a **card per host** — status · uptime · ready/total · resource count (tap → its full screen) with the host's full resource roster (each tappable).

Replaces the cramped die popover (whose in-header tap-to-open mis-rendered). Navigation is a clean overlay stack — resource → host → board → dashboard, one "back" per layer. New `/web` export: `HealthBoard`; `HostBar` now just opens it. Pairs with dependency-aware readiness: a queue that depends on a database resource shows up here as degraded "because" its dependency is.
