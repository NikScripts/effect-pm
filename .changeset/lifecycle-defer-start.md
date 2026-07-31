---
"hyperlink-ts": minor
---

Effect-shaped `Lifecycle.Service` — FiberHandle/Set + Latch + SubscriptionRef.

- **`Lifecycle.make({ run, latch?, release?, awaitBeforeTerminal?, restartable?, fiber? })`**
  - with `latch` → `ServicePausable`; without → `ServiceCore` (no pause/resume members)
- **`_tag` everywhere:** `State`, `Event`, and errors (`LifecycleUnsupported` /
  `LifecycleIllegal`) — match with `runForEachTag` / `Effect.catchTag`
- **`Lifecycle.spec` / `impl`** Spec fragments; tools via `of` / `from` (re-check Off/Draining → Illegal)
- Participating / Spec field **`lifecycleEvents`** (distinct from domain `events`)
- Daemon + WorkPool engines use `make`; WorkPool exposes `lifecycle` (`Lifecycle.State`) as badge SSOT
- **`Hyperlink.deferStart`** — Layer pipe; Idle until `start` (retires `autoStart` config)
- WorkPool control verb **`shutdown` → `stop`**; drop `status.phase` (use `lifecycle._tag`)
- **`ui/LifecycleView`** Observe pack (`pack` / `pausable`) — Lifecycle core does not import Observe
