---
"hyperlink-ts": minor
---

Effect-native `Lifecycle` — compose FiberHandle/Set + Latch; dual ops; derived events.

- **`Lifecycle.make({ run, latch?, release?, awaitBeforeTerminal?, afterStop?, fibers? })`**
- **Dual ops** on handles, Participating, *and* Tag Effects: `Lifecycle.start(lc|jobs|Jobs)` / `pause` / `resume` / `stop` / `events`
- Spec Subscribable badge: **`Lifecycle.stateRef`** / **`eventStream`**; Role stamps **`asState`** / `asStart` / …
- **`Lifecycle.impl`** wire-ready (`never` errors); duals re-check Illegal
- No projected `Service` / `of` / `from` / `*From` helpers
- Engine in `internal/lifecycle` (+ `lifecycleModel`); Scope `addFinalizer` → `stop`
- `ui/LifecycleView` pack (chrome → Agent G)

**Gate participates (P10).** Every Gate now carries the shared Lifecycle protocol built on
`Lifecycle.make({ run: Effect.never, latch, release, awaitBeforeTerminal, afterStop: Lifecycle.off })`:

- `lifecycle` badge + `lifecycleEvents` + `start` / `pause` / `resume` / `stop` on the handle.
- **Pause** admits new calls but latch-holds them (and any waiters); **stop** fails new calls with
  **`Gate.GateStopped`** while in-flight bodies always finish, then drains → `Off`.
- **Engine `run` errors on the wire:** **`GateStopped`** (`Schema.TaggedErrorClass`) and
  Effect **`RateLimiterError`** (`Schema.ErrorClass`) are **always** on Tag/Service `run`
  (alone when `error` is omitted; else unioned with the declared error) — no silent erase.
  `Effect.catchTag("GateStopped" | "RateLimiterError", …)` typechecks.
- **`stopMode: "failWaiting" | "finishWaiting"`** (default `"failWaiting"`) — waiting callers either
  fail with `GateStopped` or keep their place and run.
- Live **`setConcurrency`** (`Semaphore.resize`) and **`setRateLimit`** (`null` clears) verbs, each
  bumping `status.configVersion`. Readiness now follows the Lifecycle badge.
