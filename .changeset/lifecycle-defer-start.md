---
"hyperlink-ts": minor
---

Effect-shaped `Lifecycle.Service` — FiberHandle/Set + Latch + SubscriptionRef.

- **`Lifecycle.make({ run, latch?, release?, restartable?, fiber? })`** — compose Effect
  concurrency; Scope close runs `stop`
- **Errors:** `LifecycleUnsupported` / `LifecycleIllegal` (`Data.TaggedError` — use
  `Effect.catchTag` / `_tag`)
- **`Lifecycle.Event`** stream (`_tag`: Started / Paused / Resumed / StopRequested / Stopped)
- **`Lifecycle.spec` / `impl`** Spec fragments
- **Tools:** `Lifecycle.of` / `from` unchanged in spirit
- Daemon toolkit uses Effect-shaped `make`; WorkPool still projects via `of`
- **`Hyperlink.deferStart`** — Layer pipe; `make` stays Idle until `start`
