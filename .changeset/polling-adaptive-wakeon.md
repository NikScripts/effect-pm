---
"@nikscripts/effect-pm": minor
---

Two polling additions: `Polling.adaptive({ active, idle, factor? })` — work-aware cadence, the
complement of backoff: ticks at `active` after a work signal (`resetCadence`) and decays toward
`idle` while nothing happens. And `Polling.wakeOn(stream, wake)` — wire any stream to a cadence
control, so an external fact (a queue `add`, a store change) ends the polling wait immediately;
point it at `proc.polling.resetCadence` to snap an adaptive drainer back to full speed on arrival.
