---
"hyperlink-ts": minor
---

Effect-native `Lifecycle` — compose FiberHandle/Set + Latch; dual ops; derived events.

- **`Lifecycle.make({ run, latch?, release?, awaitBeforeTerminal?, afterStop?, fibers? })`**
  - returns `LifecyclePausable` (with latch) or `LifecycleCore`
  - `state` is a `SubscriptionRef`; `fibers` is a real Handle or Set
- **Dual ops:** `Lifecycle.start(lc)` / `pause` / `resume` / `stop` (same names overload as Spec Role stamps)
- **`Lifecycle.events(lc)`** derived from badge changes — no parallel PubSub
- Scope `addFinalizer` → `stop`; tools via `of` / `from`; Spec `lifecycleEvents`
- WorkPool / Daemon engines updated; `afterStop: Idle|Off` replaces `restartable`
- **`ui/LifecycleView`** Observe pack (`pack` / `pausable`) — chrome is Agent G
