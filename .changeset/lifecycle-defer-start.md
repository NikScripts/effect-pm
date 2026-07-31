---
"hyperlink-ts": minor
---

Effect-native `Lifecycle` — compose FiberHandle/Set + Latch; dual ops; derived events.

- **`Lifecycle.make({ run, latch?, release?, awaitBeforeTerminal?, afterStop?, fibers? })`**
- **Dual ops** on handles, Participating, *and* Tag Effects: `Lifecycle.start(lc|jobs|Jobs)` / `pause` / `resume` / `stop`
- No projected `Service` / `of` / `from` / `*From` helpers
- **`Lifecycle.events`** derived from badge changes — no parallel PubSub
- Engine in `internal/lifecycle` (+ `lifecycleModel`); Spec stamps `asStart` / `asPause` / …
- Scope `addFinalizer` → `stop`; `ui/LifecycleView` pack (chrome → Agent G)
