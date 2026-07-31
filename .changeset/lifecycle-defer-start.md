---
"hyperlink-ts": minor
---

Effect-native `Lifecycle` — compose FiberHandle/Set + Latch; dual ops; derived events.

- **`Lifecycle.make({ run, latch?, release?, awaitBeforeTerminal?, afterStop?, fibers? })`**
- **Dual ops** on handles *and* Participating: `Lifecycle.start(lc|jobs)` / `pause` / `resume` / `stop`
- **`startFrom` / `pauseFrom` / `resumeFrom` / `stopFrom(Tag)`** — no projected `Service` / `of` / `from`
- **`Lifecycle.events`** derived from badge changes — no parallel PubSub
- Engine in `internal/lifecycle` (+ `lifecycleModel`); Spec stamps `asStart` / `asPause` / …
- Scope `addFinalizer` → `stop`; `ui/LifecycleView` pack (chrome → Agent G)
