---
"hyperlink-ts": minor
---

Effect-shaped `Lifecycle.Service` — FiberHandle/Set + Latch + SubscriptionRef.

- **`Lifecycle.make({ run, latch?, release?, awaitBeforeTerminal?, restartable?, fiber? })`**
- **`_tag` everywhere:** `State`, `Event`, and errors (`LifecycleUnsupported` /
  `LifecycleIllegal`) — match with `runForEachTag` / `Effect.catchTag`
- **`Lifecycle.spec` / `impl`** Spec fragments; tools via `of` / `from`
- Daemon + WorkPool engines use `make`; WorkPool exposes `lifecycle` (`Lifecycle.State`) as badge SSOT
- **`Hyperlink.deferStart`** — Layer pipe; Idle until `start` (retires `autoStart` config)
- WorkPool control verb **`shutdown` → `stop`**; drop `status.phase` (use `lifecycle._tag`)
