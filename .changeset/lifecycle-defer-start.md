---
"hyperlink-ts": minor
---

Effect-shaped `Lifecycle.Service` — FiberHandle/Set + Latch + SubscriptionRef.

- **`Lifecycle.make({ run, latch?, release?, awaitBeforeTerminal?, restartable?, fiber? })`**
- **`_tag` everywhere:** `State`, `Event`, and errors (`LifecycleUnsupported` /
  `LifecycleIllegal`) — match with `runForEachTag` / `Effect.catchTag`
- **`Lifecycle.spec` / `impl`** Spec fragments; tools via `of` / `from`
- Daemon + WorkPool engines use `make` (WorkPool `status.phase` mirrors State)
- **`Hyperlink.deferStart`** — Layer pipe; Idle until `start`
