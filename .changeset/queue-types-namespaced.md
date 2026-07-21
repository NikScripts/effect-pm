---
"@nikscripts/effect-pm": minor
---

No more top-level exports — effect has no top-level; neither do we (breaking):

- Queue/custom-queue types moved into their namespaces: `QueueResource.QueueStatus`,
  `CustomQueueResource.CustomQueueStatus`, … (bare barrel exports removed).
- `Polling` is now a module namespace. Presets are unchanged at call sites
  (`Polling.spaced(…)`); `yield* Polling` becomes `yield* Polling.current`;
  `Layer.succeed(Polling, impl)` becomes `Polling.layer(impl)`; `PollingService` →
  `Polling.Service`; `AcceleratingPollConfig` → `Polling.AcceleratingConfig`. The Context
  tag is internal — polling is cadence policy, not a resource, so there is no `Polling.Tag`.
- Removed: `PollingService.overlap` (never read by the engine) and the leaked
  disarmed-idle-sleep internals (`DISARMED_HINT_SLEEP_MAX`, `computeDisarmedIdleSleep`, …).
