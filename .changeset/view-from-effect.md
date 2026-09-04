---
"last-ts": minor
---

**`View.fromEffect` / `View.gen` / `View.succeed`:** plain Effect → exportable React component (no Tag / DI). Runtime from `AtomReact.RuntimeProvider` — no runtime argument. `gen` = `fromEffect(Effect.gen(…))`; `succeed` = `fromEffect(Effect.succeed(…))`. Keep `"use client"` on the app module that exports the result.
